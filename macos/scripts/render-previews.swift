import AppKit
import SwiftUI

// Own-view rendering only: no screenshots or automation of the user's desktop.
@main struct PreviewRenderer {
    @MainActor static func main() throws {
        _ = NSApplication.shared
        NSApplication.shared.setActivationPolicy(.prohibited)
        let output = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
        var sample = LocalWorkspace()
        var plan = PlanCache()
        var project = PlanProject(id: -1, title: "Learn to use Flowlist")
        project.tasks = [PlanTask(id: -2, goalId: -1, title: "Understand Pomodoro"), PlanTask(id: -3, goalId: -1, parentId: -2, title: "Customize the clock"), PlanTask(id: -4, goalId: -1, title: "Review your progress")]
        plan.projects = [project]; plan.priorityIds = [-2]
        sample.plan = plan
        let store = TimerStore(preview: sample)
        try render(MenuPanel().environmentObject(store).environment(\.colorScheme, .dark), size: NSSize(width: 320, height: 400), path: output.appendingPathComponent("menu.png"))
        store.change {
            $0.timer.start(configuration: $0.configuration, at: Date().addingTimeInterval(-90))
            $0.timer.finish(at: Date())
            $0.note = "Outlined the next chapter."
        }
        try render(MenuPanel().environmentObject(store).environment(\.colorScheme, .dark), size: NSSize(width: 320, height: 350), path: output.appendingPathComponent("menu-review.png"))
        store.saveSession()
        store.change { $0.timer = FocusTimer(); $0.theme = "coast" }
        try render(MenuPanel().environmentObject(store).environment(\.colorScheme, .light), size: NSSize(width: 320, height: 400), path: output.appendingPathComponent("menu-light.png"))
        print("Rendered native views in \(output.path)")
    }
    @MainActor static func render<V: View>(_ view: V, size: NSSize, path: URL) throws {
        let host = NSHostingView(rootView: view.frame(width: size.width, height: size.height, alignment: .top).clipped())
        let window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.borderless], backing: .buffered, defer: false)
        window.contentView = host
        host.frame = NSRect(origin: .zero, size: size)
        host.layoutSubtreeIfNeeded()
        RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        host.layoutSubtreeIfNeeded()
        window.displayIfNeeded()
        guard let bitmap = host.bitmapImageRepForCachingDisplay(in: host.bounds) else { fatalError("No bitmap") }
        host.cacheDisplay(in: host.bounds, to: bitmap)
        try bitmap.representation(using: .png, properties: [:])!.write(to: path)
        // A non-presented window has no app delegate managing its lifetime.
        window.isReleasedWhenClosed = false
        window.close()
    }
}
