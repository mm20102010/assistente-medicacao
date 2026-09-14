import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        if let response = connectionOptions.notificationResponse {
            MedicationNotificationContextStore.shared.store(
                request: response.notification.request,
                source: "scene-connect"
            )
        }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = AssistenteBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    private func ensureNotificationDelegate() {
        (UIApplication.shared.delegate as? AppDelegate)?.ensureNotificationDelegate()
    }

    func sceneWillResignActive(_ scene: UIScene) {
        ensureNotificationDelegate()
    }

    func sceneDidEnterBackground(_ scene: UIScene) {
        ensureNotificationDelegate()
    }

    func sceneWillEnterForeground(_ scene: UIScene) {
        ensureNotificationDelegate()
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        ensureNotificationDelegate()
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
