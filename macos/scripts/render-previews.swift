import AppKit
import SwiftUI

// Own-view rendering only: no screenshots or automation of the user's desktop.
@main struct PreviewRenderer {
    @MainActor static func main() throws {
        _ = NSApplication.shared
        NSApplication.shared.setActivationPolicy(.prohibited)
        let output = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
        let store = TimerStore(preview: LocalWorkspace())
        for theme in Landscape.allCases {
            store.change { $0.theme = theme.rawValue }
            for scheme in [ColorScheme.dark, .light] {
                let suffix = scheme == .dark ? "dark" : "light"
                try render(FocusCard().environmentObject(store).padding(24).background(Color(nsColor: .windowBackgroundColor)).environment(\.colorScheme, scheme), size: NSSize(width: 820, height: 390), path: output.appendingPathComponent("today-\(theme.rawValue)-\(suffix).png"))
            }
        }
        try render(MenuPanel().environmentObject(store).environment(\.colorScheme, .dark), size: NSSize(width: 364, height: 370), path: output.appendingPathComponent("menu.png"))
        store.change {
            $0.timer.start(configuration: $0.configuration, at: Date().addingTimeInterval(-90))
            $0.timer.finish(at: Date())
            $0.note = "Outlined the next chapter."
        }
        try render(ReviewView().environmentObject(store).environment(\.colorScheme, .dark), size: NSSize(width: 700, height: 400), path: output.appendingPathComponent("review.png"))
        store.change { $0.timer = FocusTimer(); $0.theme = "coast" }
        try render(WorkspaceView().environmentObject(store).environment(\.colorScheme, .dark), size: NSSize(width: 1080, height: 760), path: output.appendingPathComponent("workspace.png"))
        print("Rendered native views in \(output.path)")
    }
    @MainActor static func render<V: View>(_ view: V, size: NSSize, path: URL) throws {
        let host = NSHostingView(rootView: view)
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
