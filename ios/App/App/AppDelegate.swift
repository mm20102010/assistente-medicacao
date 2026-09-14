import UIKit
import Capacitor
import UserNotifications

final class MedicationNotificationContextStore {
    static let shared = MedicationNotificationContextStore()

    private let lock = NSLock()
    private var pendingContext: [String: String]?
    private var handler: (() -> Void)?

    private init() {}

    private func isoString(fromMilliseconds milliseconds: Int64) -> String {
        let date = Date(timeIntervalSince1970: TimeInterval(milliseconds) / 1000.0)
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
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

    private func context(from request: UNNotificationRequest) -> [String: String]? {
        let userInfo = request.content.userInfo
        let type = String(userInfo["type"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let medicine = String(userInfo["medicine"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let scheduleID = String(userInfo["scheduleId"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let scheduledAt = String(userInfo["scheduledAt"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)

        if type == "scheduledMedication", !medicine.isEmpty, !scheduleID.isEmpty, !scheduledAt.isEmpty {
            return [
                "medicine": String(medicine.prefix(80)),
                "scheduleId": String(scheduleID.prefix(100)),
                "scheduledAt": String(scheduledAt.prefix(64))
            ]
        }

        // Durable fallback for already-delivered notifications created by an
        // older build: the request identifier has always carried scheduleId +
        // occurrence timestamp, and the title carries the medicine name.
        return fallbackContext(from: request)
    }

    func store(request: UNNotificationRequest) {
        guard let context = context(from: request) else { return }

        lock.lock()
        pendingContext = context
        let callback = handler
        lock.unlock()
        callback?()
    }

    func consume() -> [String: String]? {
        lock.lock()
        let context = pendingContext
        pendingContext = nil
        lock.unlock()
        return context
    }

    func setHandler(_ handler: @escaping () -> Void) {
        lock.lock()
        self.handler = handler
        let shouldNotify = pendingContext != nil
        lock.unlock()
        if shouldNotify { handler() }
    }
}

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        
        WatchSessionManager.shared.activate()
        let notificationCenter = UNUserNotificationCenter.current()
        notificationCenter.delegate = self
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
            request: response.notification.request
        )
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
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
