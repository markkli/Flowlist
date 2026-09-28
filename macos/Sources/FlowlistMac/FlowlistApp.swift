import SwiftUI

@main struct FlowlistApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @StateObject private var store = TimerStore()
    var body: some Scene {
        Window("Flowlist", id: "main") {
            WorkspaceView().environmentObject(store)
        }
        .defaultSize(width: 1080, height: 760)
        .commands {
            CommandGroup(replacing: .newItem) { }
            CommandGroup(after: .appInfo) {
                Button("Open web dashboard", action: openDashboard)
            }
        }
        MenuBarExtra {
            MenuPanel().environmentObject(store)
        } label: {
            HStack(spacing: 4) {
                Image(systemName: "timer")
                if store.workspace.showMenuTime && store.timer.isActive {
                    Text(store.remainingText).monospacedDigit()
                } else if store.timer.phase == .ready { Image(systemName: "play.fill") }
            }.accessibilityLabel("Flowlist, \(store.timer.phase.title)")
        }.menuBarExtraStyle(.window)
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { AppRouting.showToday() }
        return true
    }
    func application(_ application: NSApplication, open urls: [URL]) {
        if urls.contains(where: { $0.scheme == "flowlist" && $0.host == "today" }) { AppRouting.showToday() }
    }
}
