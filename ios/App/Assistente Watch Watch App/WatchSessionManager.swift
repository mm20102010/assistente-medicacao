import Foundation
import WatchConnectivity
import WidgetKit

private enum RecordDateCodec {
    static func date(from value: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }
}
import Combine

@MainActor
final class WatchSessionManager: NSObject, ObservableObject {
    @Published var medicines: [String] = []
    @Published var locale = "pt-BR"
    @Published var texts: [String: String] = [:]
    @Published private(set) var projectionOccurrences: [[String: String]] = []
    @Published private(set) var todayPlanned: Int = 0
    @Published private(set) var todayTaken: Int = 0
    @Published private(set) var nextScheduledAt: Date? = nil
    @Published var deliveryMessage: String?

    private struct MedicationEvent: Codable, Equatable {
        let id: String
        let medicine: String
        let occurredAt: String
        let localDate: String
        let localTime: String

        var dictionary: [String: Any] {
            [
                "type": "medicationTaken",
                "id": id,
                "medicine": medicine,
                "occurredAt": occurredAt,
                "localDate": localDate,
                "localTime": localTime
            ]
        }
    }

    private let pendingEventsKey = "mm.assistente.watch.outgoingMedicationEvents.v1"
    private let synchronizationResetAtKey = "mm.assistente.watch.lastSynchronizationResetAt.v1"
    private let lastAppliedStateSourceIDKey = "mm.assistente.watch.lastAppliedStateSourceID.v1"
    private let lastAppliedStateRevisionKey = "mm.assistente.watch.lastAppliedStateRevision.v1"
    private let retiredStateSourceIDsKey = "mm.assistente.watch.retiredStateSourceIDs.v1"
    private let maxRetiredStateSourceIDs = 16
    private let maxPendingEvents = 10_000
    private var backgroundTransferIDs = Set<String>()
    private var immediateTransferIDs = Set<String>()
    private static let immediateSendFallbackSeconds: TimeInterval = 1.5

    // Impede que o timer de uma confirmação antiga apague
    // uma mensagem mais recente.
    private var deliveryMessageGeneration = 0

    override init() {
        super.init()

        guard WCSession.isSupported() else {
            return
        }

        let session = WCSession.default
        session.delegate = self
        session.activate()

        apply(context: session.receivedApplicationContext)
    }

    func text(_ key: String, fallback: String) -> String {
        texts[key] ?? fallback
    }

    func registerMedication(_ rawMedicine: String) {
        let medicine = rawMedicine
            .split(whereSeparator: { $0.isWhitespace })
            .joined(separator: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)

        guard !medicine.isEmpty else { return }

        let event = makeMedicationEvent(
            medicine: String(medicine.prefix(80))
        )

        guard appendPendingEvent(event) else {
            showDeliveryMessage(text("saveFailed", fallback: "Não foi possível salvar"))
            return
        }
        showDeliveryMessage(text("sending", fallback: "Enviando…"))
        transmit(event)
    }

    // Exibe o estado atual da entrega. Confirmações de sucesso podem
    // desaparecer automaticamente sem apagar mensagens posteriores.
    private func showDeliveryMessage(
        _ message: String,
        dismissAfter seconds: Double? = nil
    ) {
        deliveryMessageGeneration += 1
        let generation = deliveryMessageGeneration

        deliveryMessage = message

        guard let seconds else {
            return
        }

        Task { @MainActor [weak self] in
            try? await Task.sleep(
                for: .seconds(seconds)
            )

            guard let self else {
                return
            }

            guard self.deliveryMessageGeneration == generation else {
                return
            }

            self.deliveryMessage = nil
        }
    }

    private func makeMedicationEvent(
        medicine: String
    ) -> MedicationEvent {
        let now = Date()
        let calendar = Calendar.current

        let year = calendar.component(
            .year,
            from: now
        )

        let month = calendar.component(
            .month,
            from: now
        )

        let day = calendar.component(
            .day,
            from: now
        )

        let hour = calendar.component(
            .hour,
            from: now
        )

        let minute = calendar.component(
            .minute,
            from: now
        )

        return MedicationEvent(
            id: UUID().uuidString,
            medicine: medicine,
            occurredAt: ISO8601DateFormatter().string(from: now),
            localDate: String(
                format: "%04d-%02d-%02d",
                year,
                month,
                day
            ),
            localTime: String(
                format: "%02d:%02d",
                hour,
                minute
            )
        )
    }

    private func apply(
        context: [String: Any]
    ) {
        guard !context.isEmpty else { return }

        let incomingRevision = Self.int64(context["stateRevision"]) ?? 0
        let incomingSourceID = String(context["stateSourceID"] as? String ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let lastSourceID = UserDefaults.standard.string(forKey: lastAppliedStateSourceIDKey) ?? ""
        let retiredSources = Set(UserDefaults.standard.stringArray(forKey: retiredStateSourceIDsKey) ?? [])

        // Once an identified epoch has been accepted, anonymous legacy snapshots
        // cannot regain authority. A previously retired iPhone installation also
        // cannot become authoritative again if a delayed applicationContext arrives.
        if incomingSourceID.isEmpty, !lastSourceID.isEmpty { return }
        if !incomingSourceID.isEmpty, incomingSourceID != lastSourceID, retiredSources.contains(incomingSourceID) { return }

        let sourceChanged = !incomingSourceID.isEmpty && incomingSourceID != lastSourceID
        var lastRevision = Int64(UserDefaults.standard.integer(forKey: lastAppliedStateRevisionKey))
        if sourceChanged { lastRevision = 0 }
        if incomingRevision == 0, lastRevision > 0 { return }
        if incomingRevision > 0, incomingRevision < lastRevision { return }

        if sourceChanged {
            retireStateSourceID(lastSourceID)
            UserDefaults.standard.set(incomingSourceID, forKey: lastAppliedStateSourceIDKey)
            UserDefaults.standard.set(0, forKey: lastAppliedStateRevisionKey)
        }
        if incomingRevision > 0 {
            UserDefaults.standard.set(Int(incomingRevision), forKey: lastAppliedStateRevisionKey)
        }

        if let resetAt = context["syncResetAt"] as? String {
            applySynchronizationResetIfNewer(resetAt)
        }
        if let medicines = context["medicines"] as? [String] {
            self.medicines = medicines
        }
        if let locale = context["locale"] as? String, !locale.isEmpty {
            self.locale = locale
        }
        if let rawTexts = context["texts"] as? [String: Any] {
            self.texts = rawTexts.reduce(into: [String: String]()) { result, entry in
                if let value = entry.value as? String { result[entry.key] = value }
            }
        }
        if let projection = context["projection"] as? [String: Any] {
            if let value = projection["todayPlanned"] as? Int { todayPlanned = value }
            if let value = projection["todayTaken"] as? Int { todayTaken = value }
            if let value = projection["nextScheduledAt"] as? String { nextScheduledAt = ISO8601DateFormatter().date(from:value) }
            if let raw = projection["occurrences"] as? [[String: Any]] {
                projectionOccurrences = raw.map { [
                    "scheduleId": String($0["scheduleId"] as? String ?? ""),
                    "medicine": String($0["medicine"] as? String ?? ""),
                    "at": String($0["at"] as? String ?? "")
                ] }
            }
            publishAssistenteComplicationSnapshot()
        }
    }



    private func applyOptimisticProjection(for medicine: String, at now: Date) {
        let formatter = ISO8601DateFormatter()
        let candidates = projectionOccurrences.compactMap { item -> (Date, String)? in
            guard item["medicine"]?.caseInsensitiveCompare(medicine) == .orderedSame,
                  let raw = item["at"], let date = formatter.date(from: raw) else { return nil }
            return (date, item["scheduleId"] ?? "")
        }.filter { abs($0.0.timeIntervalSince(now)) <= 3 * 3600 }
        guard let matched = candidates.min(by: { abs($0.0.timeIntervalSince(now)) < abs($1.0.timeIntervalSince(now)) }) else { return }
        let calendar = Calendar.current
        if calendar.isDate(matched.0, inSameDayAs: now) { todayTaken = min(todayPlanned, todayTaken + 1) }
        if let index = projectionOccurrences.firstIndex(where: { $0["scheduleId"] == matched.1 && $0["at"] == formatter.string(from: matched.0) }) { projectionOccurrences.remove(at: index) }
        nextScheduledAt = projectionOccurrences.compactMap { $0["at"].flatMap(formatter.date(from:)) }.filter { $0 > now }.sorted().first
        publishAssistenteComplicationSnapshot()
    }

    private func publishAssistenteComplicationSnapshot() {
        guard let defaults = UserDefaults(suiteName: "group.br.com.mmregistro.assistentemedicacao.watch") else { return }
        let payload:[String:Any] = ["todayPlanned":todayPlanned,"todayTaken":todayTaken,"nextScheduledAt":nextScheduledAt?.timeIntervalSince1970 as Any]
        defaults.set(payload, forKey:"mm.assistente.complication.snapshot.v1")
        #if canImport(WidgetKit)
        WidgetCenter.shared.reloadAllTimelines()
        #endif
    }

    private func retireStateSourceID(_ rawID: String) {
        let id = rawID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !id.isEmpty else { return }
        var retired = UserDefaults.standard.stringArray(forKey: retiredStateSourceIDsKey) ?? []
        if !retired.contains(id) { retired.append(String(id.prefix(100))) }
        if retired.count > maxRetiredStateSourceIDs {
            retired.removeFirst(retired.count - maxRetiredStateSourceIDs)
        }
        UserDefaults.standard.set(retired, forKey: retiredStateSourceIDsKey)
    }

    private static func int64(_ raw: Any?) -> Int64? {
        if let value = raw as? Int64 { return value }
        if let value = raw as? Int { return Int64(value) }
        if let value = raw as? NSNumber { return value.int64Value }
        return nil
    }

    private func applySynchronizationResetIfNewer(_ rawResetAt: String) {
        guard let incoming = RecordDateCodec.date(from: rawResetAt) else { return }
        let currentRaw = UserDefaults.standard.string(forKey: synchronizationResetAtKey)
        let current = currentRaw.flatMap { RecordDateCodec.date(from: $0) }
        guard current == nil || incoming > current! else { return }

        UserDefaults.standard.set(rawResetAt, forKey: synchronizationResetAtKey)
        guard UserDefaults.standard.string(forKey: synchronizationResetAtKey) == rawResetAt else { return }
        let retained = loadPendingEvents().filter { event in
            guard let occurred = RecordDateCodec.date(from: event.occurredAt) else { return false }
            return occurred > incoming
        }
        _ = savePendingEvents(retained)
        let retainedIDs = Set(retained.map(\.id))
        backgroundTransferIDs = backgroundTransferIDs.intersection(retainedIDs)
        immediateTransferIDs = immediateTransferIDs.intersection(retainedIDs)
    }

    private func loadPendingEvents() -> [MedicationEvent] {
        guard let data = UserDefaults.standard.data(
            forKey: pendingEventsKey
        ) else {
            return []
        }

        return (
            try? JSONDecoder().decode(
                [MedicationEvent].self,
                from: data
            )
        ) ?? []
    }

    @discardableResult
    private func savePendingEvents(
        _ events: [MedicationEvent]
    ) -> Bool {
        if events.isEmpty {
            UserDefaults.standard.removeObject(
                forKey: pendingEventsKey
            )
            return UserDefaults.standard.data(forKey: pendingEventsKey) == nil
        }

        guard let data = try? JSONEncoder().encode(events) else {
            return false
        }

        UserDefaults.standard.set(
            data,
            forKey: pendingEventsKey
        )
        guard let stored = UserDefaults.standard.data(forKey: pendingEventsKey),
              let decoded = try? JSONDecoder().decode([MedicationEvent].self, from: stored) else {
            return false
        }
        return decoded == events
    }

    @discardableResult
    private func appendPendingEvent(
        _ event: MedicationEvent
    ) -> Bool {
        var events = loadPendingEvents()

        if events.contains(where: { $0.id == event.id }) {
            return true
        }
        guard events.count < maxPendingEvents else { return false }

        events.append(event)
        return savePendingEvents(events)
    }

    @discardableResult
    private func removePendingEvent(
        id: String
    ) -> Bool {
        var events = loadPendingEvents()
        events.removeAll { $0.id == id }
        let saved = savePendingEvents(events)
        if saved {
            backgroundTransferIDs.remove(id)
            immediateTransferIDs.remove(id)
        }
        return saved
    }

    private func transmit(
        _ event: MedicationEvent
    ) {
        let session = WCSession.default

        guard session.activationState == .activated else {
            showDeliveryMessage(
                "⏳ \(self.text("waitingPhoneShort", fallback: "Aguardando iPhone"))"
            )
            return
        }

        if session.isReachable {
            sendImmediately(
                event,
                through: session
            )
        } else {
            queueBackgroundDelivery(
                event,
                through: session
            )
        }
    }

    private func sendImmediately(
        _ event: MedicationEvent,
        through session: WCSession
    ) {
        guard immediateTransferIDs.insert(event.id).inserted else {
            showDeliveryMessage(
                "⏳ \(self.text("queued", fallback: "Na fila"))"
            )
            return
        }

        scheduleImmediateSendFallback(event)

        session.sendMessage(
            event.dictionary,
            replyHandler: { reply in
                let accepted = reply["accepted"] as? Bool ?? false
                let persisted = reply["persisted"] as? Bool ?? false

                Task { @MainActor in
                    self.immediateTransferIDs.remove(event.id)
                    guard self.loadPendingEvents().contains(where: { $0.id == event.id }) else {
                        return
                    }
                    if accepted && persisted {
                        _ = self.removePendingEvent(id: event.id)
                        self.showDeliveryMessage(
                            "✓ \(event.medicine)",
                            dismissAfter: 2
                        )
                    } else if accepted || self.backgroundTransferIDs.contains(event.id) {
                        self.showDeliveryMessage(
                            "⏳ \(self.text("queued", fallback: "Na fila"))"
                        )
                    } else {
                        self.showDeliveryMessage(
                            "⏳ \(self.text("waitingPhoneShort", fallback: "Aguardando iPhone"))"
                        )
                    }
                }
            },
            errorHandler: { _ in
                Task { @MainActor in
                    self.immediateTransferIDs.remove(event.id)
                    guard self.loadPendingEvents().contains(where: { $0.id == event.id }) else {
                        return
                    }
                    self.queueBackgroundDelivery(
                        event,
                        through: WCSession.default
                    )
                }
            }
        )
    }

    private func scheduleImmediateSendFallback(
        _ event: MedicationEvent
    ) {
        Task { @MainActor [weak self] in
            try? await Task.sleep(
                for: .seconds(Self.immediateSendFallbackSeconds)
            )

            guard let self,
                  self.immediateTransferIDs.contains(event.id),
                  self.loadPendingEvents().contains(where: { $0.id == event.id }) else {
                return
            }

            // O sendMessage é somente o fast path. Se o callback interativo
            // demorar, mudamos para o transporte durável e evitamos deixar o
            // usuário preso visualmente em "Enviando…".
            self.immediateTransferIDs.remove(event.id)
            self.queueBackgroundDelivery(
                event,
                through: WCSession.default
            )
        }
    }

    private func queueBackgroundDelivery(
        _ event: MedicationEvent,
        through session: WCSession
    ) {
        guard session.activationState == .activated else {
            showDeliveryMessage(
                "⏳ \(self.text("waitingPhoneShort", fallback: "Aguardando iPhone"))"
            )
            return
        }

        #if targetEnvironment(simulator)

        // transferUserInfo não é usado no Simulator.
        // O evento permanece localmente e será tentado novamente
        // quando a conectividade mudar.
        showDeliveryMessage(
            "⏳ \(self.text("waitingPhoneShort", fallback: "Aguardando iPhone"))"
        )

        #else

        guard !backgroundTransferIDs.contains(event.id) else {
            showDeliveryMessage(
                "⏳ \(self.text("queued", fallback: "Na fila"))"
            )
            return
        }

        backgroundTransferIDs.insert(event.id)

        session.transferUserInfo(
            event.dictionary
        )

        showDeliveryMessage(
            "⏳ \(self.text("queued", fallback: "Na fila"))"
        )

        #endif
    }

    private func rebuildBackgroundTransferIDs(from session: WCSession) {
        backgroundTransferIDs = Set(
            session.outstandingUserInfoTransfers.compactMap { transfer in
                guard (transfer.userInfo["type"] as? String) == "medicationTaken" else { return nil }
                return transfer.userInfo["id"] as? String
            }
        )
    }

    private func handlePersistedAcknowledgement(_ payload: [String: Any]) {
        guard (payload["type"] as? String) == "medicationPersistedAck",
              let id = payload["id"] as? String, !id.isEmpty else { return }

        let medicine = loadPendingEvents().first(where: { $0.id == id })?.medicine
        guard removePendingEvent(id: id) else { return }
        if let medicine {
            showDeliveryMessage("✓ \(medicine)", dismissAfter: 2)
        }
    }

    private func flushPendingEvents() {
        let events = loadPendingEvents()

        guard !events.isEmpty else {
            return
        }

        let session = WCSession.default

        guard session.activationState == .activated else {
            return
        }

        for event in events {
            if session.isReachable {
                sendImmediately(
                    event,
                    through: session
                )
            } else {
                queueBackgroundDelivery(
                    event,
                    through: session
                )
            }
        }
    }
}

extension WatchSessionManager: WCSessionDelegate {
    nonisolated func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        let context =
            session.receivedApplicationContext

        Task { @MainActor in
            self.apply(context: context)
            self.rebuildBackgroundTransferIDs(from: session)
            self.flushPendingEvents()
        }
    }

    nonisolated func session(
        _ session: WCSession,
        didReceiveApplicationContext applicationContext: [String: Any]
    ) {
        Task { @MainActor in
            self.apply(
                context: applicationContext
            )
        }
    }

    nonisolated func sessionReachabilityDidChange(
        _ session: WCSession
    ) {
        Task { @MainActor in
            self.rebuildBackgroundTransferIDs(from: session)
            self.flushPendingEvents()
        }
    }

    nonisolated func session(
        _ session: WCSession,
        didReceiveMessage message: [String: Any]
    ) {
        Task { @MainActor in
            switch message["type"] as? String {
            case "watchState": self.apply(context: message)
            case "medicationPersistedAck": self.handlePersistedAcknowledgement(message)
            default: break
            }
        }
    }

    nonisolated func session(
        _ session: WCSession,
        didReceiveUserInfo userInfo: [String: Any]
    ) {
        Task { @MainActor in
            self.handlePersistedAcknowledgement(userInfo)
        }
    }

    nonisolated func session(
        _ session: WCSession,
        didFinish userInfoTransfer: WCSessionUserInfoTransfer,
        error: Error?
    ) {
        let id =
            userInfoTransfer.userInfo["id"] as? String

        Task { @MainActor in
            guard let id else {
                return
            }

            self.backgroundTransferIDs.remove(id)
            // ACK e didFinish podem chegar em qualquer ordem. Se o ACK já removeu
            // este UUID da fila local, um callback de transporte atrasado não pode
            // regredir a UI de sucesso para “Na fila”.
            guard self.loadPendingEvents().contains(where: { $0.id == id }) else { return }

            if error == nil {
                self.showDeliveryMessage(
                    "⏳ \(self.text("queued", fallback: "Na fila"))"
                )
            } else {
                self.showDeliveryMessage(
                    "⏳ \(self.text("waitingPhoneShort", fallback: "Aguardando iPhone"))"
                )
            }
        }
    }
}
