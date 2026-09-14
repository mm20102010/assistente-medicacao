import Foundation
import WatchConnectivity
import Capacitor
import UserNotifications

private enum RecordDateCodec {
    static func date(from value: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }
}

// Owns the latest medicine list on iOS and the durable queue of medication
// events received from the paired Apple Watch. The web app remains the source
// of truth for medicines and for the IndexedDB history.
final class WatchSessionManager: NSObject, WCSessionDelegate {
    static let shared = WatchSessionManager()

    private struct MedicationEvent: Codable, Equatable {
        let id: String
        let medicine: String
        let occurredAt: String
        let localDate: String
        let localTime: String
        let scheduleId: String?
        let scheduledAt: String?

        var dictionary: [String: Any] {
            var payload: [String: Any] = [
                "type": "medicationTaken",
                "id": id,
                "medicine": medicine,
                "occurredAt": occurredAt,
                "localDate": localDate,
                "localTime": localTime
            ]
            if let scheduleId, !scheduleId.isEmpty { payload["scheduleId"] = scheduleId }
            if let scheduledAt, !scheduledAt.isEmpty { payload["scheduledAt"] = scheduledAt }
            return payload
        }
    }

    private var latestMedicines: [String] = []
    private var latestLocale = "pt-BR"
    private var latestTexts: [String: String] = [:]
    private var latestProjection: [String: Any] = [:]
    private let stateQueue = DispatchQueue(label: "br.com.mmregistro.assistentemedicacao.watch-state")
    private let eventQueue = DispatchQueue(label: "br.com.mmregistro.assistentemedicacao.watch-events")
    private let pendingEventsKey = "mm.assistente.watch.pendingMedicationEvents.v1"
    private let acknowledgedEventIDsKey = "mm.assistente.watch.acknowledgedMedicationEventIDs.v1"
    private let synchronizationResetAtKey = "mm.assistente.watch.synchronizationResetAt.v1"
    private static let stateSourceIDKey = "mm.assistente.watch.stateSourceID.v1"
    private static let stateRevisionKey = "mm.assistente.watch.stateRevision.v1"
    private static let stateSourceID = WatchSessionManager.loadOrCreatePersistentIdentifier(forKey: stateSourceIDKey)
    private let maxPendingEvents = 10_000
    private let maxAcknowledgedEventIDs = 10_000
    private var medicationEventAvailableHandler: (() -> Void)?
    private var latestStateRevision = Int64(UserDefaults.standard.integer(forKey: WatchSessionManager.stateRevisionKey))

    private override init() {
        super.init()
    }

    private static func loadOrCreatePersistentIdentifier(forKey key: String) -> String {
        if let existing = UserDefaults.standard.string(forKey: key), !existing.isEmpty { return existing }
        let value = UUID().uuidString
        UserDefaults.standard.set(value, forKey: key)
        // Fail closed: não use uma epoch efêmera se a persistência local falhar.
        return UserDefaults.standard.string(forKey: key) == value ? value : ""
    }

    func activate() {
        guard WCSession.isSupported() else {
            print("WatchConnectivity não suportado neste dispositivo.")
            return
        }

        let session = WCSession.default
        session.delegate = self
        session.activate()
    }

    func setMedicationEventAvailableHandler(_ handler: @escaping () -> Void) {
        stateQueue.sync {
            medicationEventAvailableHandler = handler
        }

        // If an event arrived before the Capacitor bridge finished loading,
        // wake JavaScript as soon as the bridge becomes available.
        if !pendingMedicationEvents().isEmpty {
            handler()
        }
    }

    @discardableResult
    func updateWatchState(
        medicines: [String],
        locale: String,
        texts: [String: String],
        projection: [String: Any] = [:]
    ) -> Bool {
        let normalizedMedicines = Self.normalizedMedicines(medicines)
        let normalizedLocale = Self.compactString(locale, maxLength: 20)
        let normalizedTexts = Self.normalizedTexts(texts)
        stateQueue.sync {
            latestMedicines = normalizedMedicines
            latestLocale = normalizedLocale
            latestTexts = normalizedTexts
            latestProjection = projection
            _ = nextStateRevisionLocked()
        }
        return sendLatestWatchState()
    }

    func pendingMedicationEvents() -> [[String: Any]] {
        eventQueue.sync {
            loadPendingEvents().map(\.dictionary)
        }
    }

    @discardableResult
    func acknowledgeMedicationEvent(id rawID: String) -> Bool {
        let id = rawID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !id.isEmpty else { return false }

        let acknowledged = eventQueue.sync { () -> Bool in
            let previousAcknowledged = UserDefaults.standard.stringArray(forKey: acknowledgedEventIDsKey) ?? []
            var nextAcknowledged = previousAcknowledged
            if !nextAcknowledged.contains(id) {
                nextAcknowledged.append(id)
                if nextAcknowledged.count > maxAcknowledgedEventIDs {
                    nextAcknowledged.removeFirst(nextAcknowledged.count - maxAcknowledgedEventIDs)
                }
                UserDefaults.standard.set(nextAcknowledged, forKey: acknowledgedEventIDsKey)
            }

            let storedAcknowledged = UserDefaults.standard.stringArray(forKey: acknowledgedEventIDsKey) ?? []
            guard storedAcknowledged.contains(id) else { return false }

            var pending = loadPendingEvents()
            pending.removeAll { $0.id == id }
            guard savePendingEvents(pending) else {
                if previousAcknowledged.isEmpty {
                    UserDefaults.standard.removeObject(forKey: acknowledgedEventIDsKey)
                } else {
                    UserDefaults.standard.set(previousAcknowledged, forKey: acknowledgedEventIDsKey)
                }
                return false
            }

            return true
        }

        if acknowledged {
            sendPersistedAcknowledgementToWatch(id: id)
        }
        return acknowledged
    }

    @discardableResult
    func discardMedicationEventIfKnown(id rawID: String) -> Bool {
        let id = rawID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !id.isEmpty else { return false }

        let known = eventQueue.sync {
            let acknowledged = Set(UserDefaults.standard.stringArray(forKey: acknowledgedEventIDsKey) ?? [])
            if acknowledged.contains(id) { return true }
            return loadPendingEvents().contains { $0.id == id }
        }

        // Local iPhone records have never entered the native Watch queue, so
        // there is nothing to tombstone. A known Watch UUID is consumed before
        // the IndexedDB deletion so a delayed retransmission cannot resurrect it.
        guard known else { return true }
        return acknowledgeMedicationEvent(id: id)
    }

    @discardableResult
    func resetSynchronizationState(at rawResetAt: String) -> Bool {
        let resetAt = Self.compactString(rawResetAt, maxLength: 64)
        guard let cutoff = RecordDateCodec.date(from: resetAt) else { return false }

        let persisted = eventQueue.sync { () -> Bool in
            UserDefaults.standard.set(resetAt, forKey: synchronizationResetAtKey)
            guard UserDefaults.standard.string(forKey: synchronizationResetAtKey) == resetAt else { return false }

            let retained = loadPendingEvents().filter { event in
                guard let occurred = RecordDateCodec.date(from: event.occurredAt) else { return false }
                return occurred > cutoff
            }
            return savePendingEvents(retained)
        }

        if persisted {
            stateQueue.sync { _ = nextStateRevisionLocked() }
            _ = sendLatestWatchState()
        }
        return persisted
    }


    private func nextStateRevisionLocked() -> Int64 {
        latestStateRevision += 1
        UserDefaults.standard.set(Int(latestStateRevision), forKey: Self.stateRevisionKey)
        return latestStateRevision
    }

    private static func normalizedMedicines(_ medicines: [String]) -> [String] {
        var result: [String] = []
        var seen = Set<String>()

        for rawValue in medicines {
            let compact = compactString(rawValue, maxLength: 80)
            guard !compact.isEmpty else { continue }

            let key = compact.folding(
                options: [.caseInsensitive, .diacriticInsensitive],
                locale: Locale(identifier: "pt_BR")
            )

            guard seen.insert(key).inserted else { continue }
            result.append(compact)
            if result.count == 200 { break }
        }

        return result
    }

    private static func compactString(_ rawValue: String, maxLength: Int) -> String {
        let compact = rawValue
            .split(whereSeparator: { $0.isWhitespace })
            .joined(separator: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return String(compact.prefix(maxLength))
    }

    private static func normalizedTexts(_ texts: [String: String]) -> [String: String] {
        var result: [String: String] = [:]
        for (rawKey, rawValue) in texts.prefix(30) {
            let key = compactString(rawKey, maxLength: 40)
            let value = compactString(rawValue, maxLength: 120)
            if !key.isEmpty, !value.isEmpty { result[key] = value }
        }
        return result
    }

    private static func normalizedMedicationEvent(from payload: [String: Any]) -> MedicationEvent? {
        guard (payload["type"] as? String) == "medicationTaken" else { return nil }

        let id = compactString(payload["id"] as? String ?? "", maxLength: 100)
        let medicine = compactString(payload["medicine"] as? String ?? "", maxLength: 80)
        let occurredAt = compactString(payload["occurredAt"] as? String ?? "", maxLength: 64)
        let localDate = compactString(payload["localDate"] as? String ?? "", maxLength: 10)
        let localTime = compactString(payload["localTime"] as? String ?? "", maxLength: 5)
        let scheduleId = compactString(payload["scheduleId"] as? String ?? "", maxLength: 100)
        let scheduledAt = compactString(payload["scheduledAt"] as? String ?? "", maxLength: 64)

        guard !id.isEmpty, !medicine.isEmpty else { return nil }
        guard RecordDateCodec.date(from: occurredAt) != nil else { return nil }
        guard localDate.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil else { return nil }
        guard localTime.range(of: #"^\d{2}:\d{2}$"#, options: .regularExpression) != nil else { return nil }
        if !scheduledAt.isEmpty, RecordDateCodec.date(from: scheduledAt) == nil { return nil }

        return MedicationEvent(
            id: id,
            medicine: medicine,
            occurredAt: occurredAt,
            localDate: localDate,
            localTime: localTime,
            scheduleId: scheduleId.isEmpty ? nil : scheduleId,
            scheduledAt: scheduledAt.isEmpty ? nil : scheduledAt
        )
    }

    private func loadPendingEvents() -> [MedicationEvent] {
        guard let data = UserDefaults.standard.data(forKey: pendingEventsKey) else { return [] }
        return (try? JSONDecoder().decode([MedicationEvent].self, from: data)) ?? []
    }

    @discardableResult
    private func savePendingEvents(_ events: [MedicationEvent]) -> Bool {
        if events.isEmpty {
            UserDefaults.standard.removeObject(forKey: pendingEventsKey)
            return UserDefaults.standard.data(forKey: pendingEventsKey) == nil
        }

        guard let data = try? JSONEncoder().encode(events) else { return false }
        UserDefaults.standard.set(data, forKey: pendingEventsKey)
        guard let stored = UserDefaults.standard.data(forKey: pendingEventsKey),
              let decoded = try? JSONDecoder().decode([MedicationEvent].self, from: stored) else {
            return false
        }
        return decoded == events
    }

    private func isAtOrBeforeSynchronizationReset(_ event: MedicationEvent) -> Bool {
        guard let resetAt = UserDefaults.standard.string(forKey: synchronizationResetAtKey),
              let cutoff = RecordDateCodec.date(from: resetAt),
              let occurred = RecordDateCodec.date(from: event.occurredAt) else {
            return false
        }
        return occurred <= cutoff
    }

    private func acceptMedicationEvent(_ payload: [String: Any]) -> (accepted: Bool, duplicate: Bool, persisted: Bool) {
        guard let event = Self.normalizedMedicationEvent(from: payload) else {
            return (false, false, false)
        }

        let result: (accepted: Bool, duplicate: Bool, pending: Bool, persisted: Bool) = eventQueue.sync {
            if isAtOrBeforeSynchronizationReset(event) {
                return (true, true, false, true)
            }

            let acknowledged = Set(UserDefaults.standard.stringArray(forKey: acknowledgedEventIDsKey) ?? [])
            if acknowledged.contains(event.id) {
                return (true, true, false, true)
            }

            var pending = loadPendingEvents()
            if pending.contains(where: { $0.id == event.id }) {
                return (true, true, true, false)
            }

            guard pending.count < maxPendingEvents else {
                print("Fila de eventos do Watch atingiu o limite de segurança.")
                return (false, false, false, false)
            }

            pending.append(event)
            guard savePendingEvents(pending) else {
                print("Falha ao persistir evento do Watch na fila nativa:", event.id)
                return (false, false, false, false)
            }
            print("Evento de medicação recebido do Watch:", event.id, event.medicine)
            return (true, false, true, false)
        }

        // This notification only wakes the WebView. End-to-end acknowledgement is
        // sent to the Watch only after JavaScript confirms IndexedDB persistence.
        if result.accepted && result.pending {
            let handler = stateQueue.sync { medicationEventAvailableHandler }
            handler?()
        }

        return (result.accepted, result.duplicate, result.persisted)
    }

    private func sendPersistedAcknowledgementToWatch(id: String) {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        guard session.activationState == .activated else { return }

        let payload: [String: Any] = [
            "type": "medicationPersistedAck",
            "id": id
        ]

        if session.isReachable {
            session.sendMessage(payload, replyHandler: nil) { error in
                print("ACK imediato ao Watch falhou; mantendo entrega em background:", error.localizedDescription)
            }
        }
        session.transferUserInfo(payload)
    }

    @discardableResult
    private func sendLatestWatchState() -> Bool {
        guard !Self.stateSourceID.isEmpty else {
            print("Estado do Watch não enviado: stateSourceID ainda não possui persistência confirmada.")
            return false
        }
        guard WCSession.isSupported() else { return false }

        let session = WCSession.default
        guard session.activationState == .activated else {
            return false
        }

        let snapshot = stateQueue.sync {
            (medicines: latestMedicines, locale: latestLocale, texts: latestTexts, revision: latestStateRevision)
        }
        guard !snapshot.medicines.isEmpty else { return false }

        var context: [String: Any] = [
            "schemaVersion": 4,
            "stateSourceID": Self.stateSourceID,
            "stateRevision": snapshot.revision,
            "medicines": snapshot.medicines,
            "locale": snapshot.locale,
            "texts": snapshot.texts
        ]
        if let resetAt = UserDefaults.standard.string(forKey: synchronizationResetAtKey) {
            context["syncResetAt"] = resetAt
        }

        do {
            try session.updateApplicationContext(context)
            if session.isReachable {
                var liveContext = context
                liveContext["type"] = "watchState"
                session.sendMessage(liveContext, replyHandler: nil) { error in
                    print("Fast path do estado do Watch falhou; applicationContext permanece autoritativo:", error.localizedDescription)
                }
            }
            print("Estado atual enviado ao Watch:", snapshot.medicines, snapshot.locale)
            return true
        } catch {
            print("Erro ao enviar lista ao Watch:", error.localizedDescription)
            return false
        }
    }

    func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        print("WatchConnectivity iOS ativado:", activationState.rawValue)

        if activationState == .activated {
            sendLatestWatchState()
        }

        if let error {
            print("Erro de ativação:", error.localizedDescription)
        }
    }

    func session(
        _ session: WCSession,
        didReceiveMessage message: [String: Any],
        replyHandler: @escaping ([String: Any]) -> Void
    ) {
        let result = acceptMedicationEvent(message)
        replyHandler([
            "accepted": result.accepted,
            "duplicate": result.duplicate,
            "persisted": result.persisted
        ])
    }

    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any]) {
        let result = acceptMedicationEvent(userInfo)
        if !result.accepted {
            print("Evento em background do Watch foi rejeitado por formato inválido.")
        }
    }

    func sessionDidBecomeInactive(_ session: WCSession) {
    }

    func sessionDidDeactivate(_ session: WCSession) {
        session.activate()
    }
}

// Local Capacitor plugin: JavaScript <-> Swift <-> WatchConnectivity.
@objc(AssistenteWatchPlugin)
public class AssistenteWatchPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AssistenteWatchPlugin"
    public let jsName = "AssistenteWatch"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "syncMedicines", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getPendingMedicationEvents", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "acknowledgeMedicationEvent", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "discardMedicationEvent", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resetSynchronizationState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reconcileMedicationNotifications", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "consumeScheduledMedicationNotificationContext", returnType: CAPPluginReturnPromise)
    ]

    func notifyMedicationEventAvailable() {
        notifyListeners("watchMedicationEventAvailable", data: ["available": true])
    }

    func notifyScheduledMedicationNotificationOpened() {
        notifyListeners("scheduledMedicationNotificationOpened", data: ["available": true])
    }

    @objc func syncMedicines(_ call: CAPPluginCall) {
        let medicines = call.getArray("medicines", String.self) ?? []
        guard !medicines.isEmpty else {
            call.reject("A lista de remédios não pode estar vazia.")
            return
        }

        let locale = call.getString("locale") ?? "pt-BR"
        let rawTexts = call.getObject("texts") ?? [:]
        let projection = call.getObject("projection") ?? [:]
        let texts = rawTexts.reduce(into: [String: String]()) { result, entry in
            if let value = entry.value as? String { result[entry.key] = value }
        }

        let delivered = WatchSessionManager.shared.updateWatchState(
            medicines: medicines,
            locale: locale,
            texts: texts,
            projection: projection
        )
        call.resolve([
            "accepted": true,
            "delivered": delivered,
            "count": medicines.count
        ])
    }

    @objc func getPendingMedicationEvents(_ call: CAPPluginCall) {
        let events = WatchSessionManager.shared.pendingMedicationEvents()
        call.resolve([
            "events": events,
            "count": events.count
        ])
    }

    @objc func acknowledgeMedicationEvent(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), !id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            call.reject("ID do evento é obrigatório.")
            return
        }

        let acknowledged = WatchSessionManager.shared.acknowledgeMedicationEvent(id: id)
        call.resolve([
            "acknowledged": acknowledged,
            "id": id
        ])
    }

    @objc func discardMedicationEvent(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), !id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            call.reject("ID do evento é obrigatório.")
            return
        }

        let discarded = WatchSessionManager.shared.discardMedicationEventIfKnown(id: id)
        call.resolve([
            "discarded": discarded,
            "id": id
        ])
    }

    @objc func resetSynchronizationState(_ call: CAPPluginCall) {
        guard let resetAt = call.getString("resetAt"), !resetAt.isEmpty else {
            call.reject("Data de reset é obrigatória.")
            return
        }

        let reset = WatchSessionManager.shared.resetSynchronizationState(at: resetAt)
        call.resolve([
            "reset": reset,
            "resetAt": resetAt
        ])
    }

    @objc func consumeScheduledMedicationNotificationContext(_ call: CAPPluginCall) {
        guard let context = MedicationNotificationContextStore.shared.consume() else {
            call.resolve(["available": false])
            return
        }
        call.resolve([
            "available": true,
            "medicine": context["medicine"] ?? "",
            "scheduleId": context["scheduleId"] ?? "",
            "scheduledAt": context["scheduledAt"] ?? ""
        ])
    }

    @objc func reconcileMedicationNotifications(_ call: CAPPluginCall) {
        let enabled = call.getBool("enabled") ?? true
        let raw = call.getArray("notifications", JSObject.self) ?? []
        let center = UNUserNotificationCenter.current()
        center.getPendingNotificationRequests { pending in
            let owned = pending.map(\.identifier).filter { $0.hasPrefix("medsched.") }
            center.removePendingNotificationRequests(withIdentifiers: owned)
            guard enabled else { call.resolve(["accepted": true, "scheduled": 0]); return }
            center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
                guard granted, error == nil else { call.resolve(["accepted": false, "scheduled": 0]); return }
                let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
                let fallback = ISO8601DateFormatter()
                let group = DispatchGroup(); var scheduled = 0
                for item in raw.prefix(60) {
                    guard let id = item["id"] as? String, id.hasPrefix("medsched."),
                          let title = item["title"] as? String,
                          let atRaw = item["at"] as? String,
                          let date = formatter.date(from: atRaw) ?? fallback.date(from: atRaw), date > Date() else { continue }
                    let content = UNMutableNotificationContent(); content.title = title; content.body = (item["body"] as? String) ?? ""; content.sound = .default; content.categoryIdentifier = "MEDICATION_SCHEDULED"
                    let scheduleId = String(item["scheduleId"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                    let medicine = String(item["medicine"] as? String ?? title).trimmingCharacters(in: .whitespacesAndNewlines)
                    let scheduledAt = String(item["scheduledAt"] as? String ?? atRaw).trimmingCharacters(in: .whitespacesAndNewlines)
                    if !scheduleId.isEmpty, !medicine.isEmpty, !scheduledAt.isEmpty {
                        content.userInfo = [
                            "type": "scheduledMedication",
                            "scheduleId": String(scheduleId.prefix(100)),
                            "medicine": String(medicine.prefix(80)),
                            "scheduledAt": String(scheduledAt.prefix(64))
                        ]
                    }
                    let comps = Calendar.current.dateComponents([.year,.month,.day,.hour,.minute], from: date)
                    group.enter(); center.add(UNNotificationRequest(identifier:id, content:content, trigger:UNCalendarNotificationTrigger(dateMatching: comps, repeats:false))) { error in if error == nil { scheduled += 1 }; group.leave() }
                }
                group.notify(queue:.main) { call.resolve(["accepted": true, "scheduled": scheduled]) }
            }
        }
    }
}

// Registers the local plugin as soon as Capacitor finishes loading its bridge.
final class AssistenteBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        let watchPlugin = AssistenteWatchPlugin()
        bridge?.registerPluginInstance(watchPlugin)

        WatchSessionManager.shared.setMedicationEventAvailableHandler { [weak watchPlugin] in
            DispatchQueue.main.async {
                watchPlugin?.notifyMedicationEventAvailable()
            }
        }
        MedicationNotificationContextStore.shared.setHandler { [weak watchPlugin] in
            DispatchQueue.main.async {
                watchPlugin?.notifyScheduledMedicationNotificationOpened()
            }
        }
    }
}
