//
//  Assistente_WatchApp.swift
//  Assistente Watch Watch App
//
//  Created by Marcelo Moreira on 11/08/26.
//

import SwiftUI
import UserNotifications

extension Notification.Name {
    static let assistenteScheduledMedicationNotificationOpened = Notification.Name(
        "br.com.mmregistro.assistentemedicacao.watch.notification-opened"
    )
}

final class WatchNotificationRouter: NSObject, UNUserNotificationCenterDelegate {
    static let shared = WatchNotificationRouter()

    private let pendingContextKey = "mm.assistente.watch.pendingNotificationContext.v1"

    private override init() {
        super.init()
    }

    func configure() {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        center.setNotificationCategories([
            UNNotificationCategory(
                identifier: "MEDICATION_SCHEDULED",
                actions: [],
                intentIdentifiers: [],
                options: []
            )
        ])
    }

    private static func validISODate(_ value: String) -> Bool {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: value) != nil || ISO8601DateFormatter().date(from: value) != nil
    }

    static func consumePendingContext() -> [String: String]? {
        let key = WatchNotificationRouter.shared.pendingContextKey
        guard let raw = UserDefaults.standard.dictionary(forKey: key) else { return nil }
        UserDefaults.standard.removeObject(forKey: key)
        let medicine = String(raw["medicine"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let scheduleId = String(raw["scheduleId"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let scheduledAt = String(raw["scheduledAt"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !medicine.isEmpty, !scheduleId.isEmpty, Self.validISODate(scheduledAt) else { return nil }
        return ["medicine": medicine, "scheduleId": scheduleId, "scheduledAt": scheduledAt]
    }

    private func persistContext(from userInfo: [AnyHashable: Any]) -> Bool {
        guard (userInfo["type"] as? String) == "scheduledMedication" else { return false }
        let medicine = String(userInfo["medicine"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let scheduleId = String(userInfo["scheduleId"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let scheduledAt = String(userInfo["scheduledAt"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !medicine.isEmpty, !scheduleId.isEmpty, Self.validISODate(scheduledAt) else { return false }
        UserDefaults.standard.set([
            "medicine": String(medicine.prefix(80)),
            "scheduleId": String(scheduleId.prefix(100)),
            "scheduledAt": String(scheduledAt.prefix(64))
        ], forKey: pendingContextKey)
        return true
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        defer { completionHandler() }
        guard response.actionIdentifier != UNNotificationDismissActionIdentifier else { return }
        guard persistContext(from: response.notification.request.content.userInfo) else { return }
        DispatchQueue.main.async {
            NotificationCenter.default.post(
                name: .assistenteScheduledMedicationNotificationOpened,
                object: nil
            )
        }
    }
}

@main
struct Assistente_Watch_Watch_AppApp: App {
    init() {
        WatchNotificationRouter.shared.configure()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
