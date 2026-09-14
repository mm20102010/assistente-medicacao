import UIKit
import Capacitor
import UserNotifications

final class MedicationNotificationContextStore {
    static let shared = MedicationNotificationContextStore()

    private let lock = NSLock()
    private var pendingContext: [String: String]?
    private var handler: (() -> Void)?
    private let persistedContextKey = "mm.assistente.pendingScheduledNotificationContext.v2"
    private let maxContextAge: TimeInterval = 15 * 60

    private init() {}

    private func isoString(from date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }

    private func isoString(fromMilliseconds milliseconds: Int64) -> String {
        isoString(from: Date(timeIntervalSince1970: TimeInterval(milliseconds) / 1000.0))
    }

    private func fallbackContext(from request: UNNotificationRequest) -> [String: String]? {
        let identifier = request.identifier
        guard identifier.hasPrefix("medsched.") else { return nil }

        let suffix = String(identifier.dropFirst("medsched.".count))
        guard let separator = suffix.lastIndex(of: ".") else { return nil }
        let scheduleID = String(suffix[..<separator]).trimmingCharacters(in: .whitespacesAndNewlines)
        let millisecondsRaw = String(suffix[suffix.index(after: separator)...])
        guard !scheduleID.isEmpty, let milliseconds = Int64(millisecondsRaw) else { return nil }

        let medicine = request.content.title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !medicine.isEmpty else { return nil }

        return [
            "medicine": String(medicine.prefix(80)),
            "scheduleId": String(scheduleID.prefix(100)),
            "scheduledAt": String(isoString(fromMilliseconds: milliseconds).prefix(64))
        ]
    }

    private func context(from request: UNNotificationRequest, source: String) -> [String: String]? {
        let userInfo = request.content.userInfo
        let type = String(userInfo["type"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let medicine = String(userInfo["medicine"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let scheduleID = String(userInfo["scheduleId"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let scheduledAt = String(userInfo["scheduledAt"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)

        var base: [String: String]?
        if type == "scheduledMedication", !medicine.isEmpty, !scheduleID.isEmpty, !scheduledAt.isEmpty {
            base = [
                "medicine": String(medicine.prefix(80)),
                "scheduleId": String(scheduleID.prefix(100)),
                "scheduledAt": String(scheduledAt.prefix(64))
            ]
        } else {
            // Durable fallback for already-delivered notifications created by an
            // older build: the request identifier carries scheduleId + timestamp.
            base = fallbackContext(from: request)
        }
        guard var context = base else { return nil }
        context["capturedAt"] = isoString(from: Date())
        context["captureSource"] = String(source.prefix(40))
        context["requestIdentifier"] = String(request.identifier.prefix(180))
        return context
    }

    private func validPersistedContextLocked() -> [String: String]? {
        guard let raw = UserDefaults.standard.dictionary(forKey: persistedContextKey) as? [String: String] else { return nil }
        guard let capturedRaw = raw["capturedAt"] else {
            UserDefaults.standard.removeObject(forKey: persistedContextKey)
            return nil
        }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let fallback = ISO8601DateFormatter()
        guard let captured = formatter.date(from: capturedRaw) ?? fallback.date(from: capturedRaw),
              Date().timeIntervalSince(captured) <= maxContextAge else {
            UserDefaults.standard.removeObject(forKey: persistedContextKey)
            return nil
        }
        return raw
    }

    func store(request: UNNotificationRequest, source: String = "notification-center") {
        guard let context = context(from: request, source: source) else { return }

        lock.lock()
        pendingContext = context
        UserDefaults.standard.set(context, forKey: persistedContextKey)
        let callback = handler
        lock.unlock()
        callback?()
    }

    func consume() -> [String: String]? {
        lock.lock()
        let context = pendingContext ?? validPersistedContextLocked()
        pendingContext = nil
        UserDefaults.standard.removeObject(forKey: persistedContextKey)
        lock.unlock()
        return context
    }

    func setHandler(_ handler: @escaping () -> Void) {
        lock.lock()
        self.handler = handler
        let shouldNotify = pendingContext != nil || validPersistedContextLocked() != nil
        lock.unlock()
        if shouldNotify { handler() }
    }
}

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate {

    var window: UIWindow?

    func ensureNotificationDelegate() {
        // Capacitor may assign its own notification delegate while the bridge is
        // loading. Reassert our delegate unconditionally on lifecycle/bridge
        // boundaries so notification taps always reach this AppDelegate.
        UNUserNotificationCenter.current().delegate = self
    }

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        
        WatchSessionManager.shared.activate()
        let notificationCenter = UNUserNotificationCenter.current()
        ensureNotificationDelegate()
        notificationCenter.setNotificationCategories([
            UNNotificationCategory(
                identifier: "MEDICATION_SCHEDULED",
                actions: [],
                intentIdentifiers: [],
                options: []
            )
        ])
        
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
        MedicationNotificationContextStore.shared.store(
            request: response.notification.request,
            source: "notification-center"
        )
    }

    func applicationWillResignActive(_ application: UIApplication) {
        ensureNotificationDelegate()
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        ensureNotificationDelegate()
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        ensureNotificationDelegate()
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        ensureNotificationDelegate()
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}
