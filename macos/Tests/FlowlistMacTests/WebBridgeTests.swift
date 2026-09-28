import Foundation
import Testing
import FlowlistCore
@testable import FlowlistMac

@MainActor struct WebBridgeTests {
    @Test func bundleHandlerRejectsRemoteAndEscapingPaths() throws {
        let handler = WorkspaceAssetHandler(root: URL(fileURLWithPath: "/tmp/flowlist-ui"))
        #expect(handler.asset(for: URL(string: "https://workspace/assets/main.js")!) == nil)
        #expect(handler.asset(for: URL(string: "flowlist-app://evil/assets/main.js")!) == nil)
        #expect(handler.asset(for: URL(string: "flowlist-app://workspace/%252e%252e/private.json")!) == nil)
        #expect(handler.asset(for: URL(string: "flowlist-app://workspace/")!)?.path == "/tmp/flowlist-ui/index.html")
    }
    @Test func bridgeClockCommandsDoNotAcceptFabricatedTime() async throws {
        var workspace = LocalWorkspace()
        let start = Date().addingTimeInterval(-60)
        workspace.timer.start(configuration: workspace.configuration, at: start)
        workspace.timer.finish(at: start.addingTimeInterval(45))
        let store = TimerStore(preview: workspace), bridge = WebBridge(store: TimerStore(preview: LocalWorkspace()))
        let runningBridge = WebBridge(store: store)
        _ = try await runningBridge.handle(["op": "timer", "action": "draft", "id": workspace.timer.id.uuidString, "summary": "Local note", "selections": []])
        let body: [String: Any] = ["client_id": workspace.timer.id.uuidString, "actual_minutes": 999999, "summary": "Forged", "tasks": []]
        _ = try await runningBridge.handle(["op": "api", "path": "/sessions", "method": "POST", "body": body])
        #expect(store.workspace.sessions.count == 1)
        #expect(store.workspace.sessions[0].seconds == 45)
        #expect(store.workspace.sessions[0].note == "Local note")
        _ = try await runningBridge.handle(["op": "api", "path": "/sessions", "method": "POST", "body": body])
        #expect(store.workspace.sessions.count == 1)
        await #expect(throws: (any Error).self) {
            _ = try await bridge.handle(["op": "api", "path": "/sessions", "method": "POST", "body": body])
        }
    }
    @Test func staleDraftCannotOverwriteAnotherReview() async throws {
        var workspace = LocalWorkspace()
        workspace.timer.start(configuration: workspace.configuration, at: Date().addingTimeInterval(-12))
        workspace.timer.finish(at: Date()); workspace.note = "Keep this"
        let store = TimerStore(preview: workspace), bridge = WebBridge(store: TimerStore(preview: workspace))
        await #expect(throws: (any Error).self) {
            _ = try await bridge.handle(["op": "timer", "action": "draft", "id": UUID().uuidString, "summary": "Stale note", "selections": []])
        }
        #expect(store.workspace.note == "Keep this")
        #expect(bridge.store.workspace.note == "Keep this")
    }
    @Test func snapshotUsesNativePausedTimeAndIncludesNoCredentials() throws {
        var workspace = LocalWorkspace()
        let start = Date().addingTimeInterval(-30)
        workspace.timer.start(configuration: workspace.configuration, at: start)
        workspace.timer.pause(at: start.addingTimeInterval(10))
        let bridge = WebBridge(store: TimerStore(preview: workspace))
        let snapshot = try #require(bridge.timerSnapshot() as? [String: Any])
        #expect(snapshot["remainingSeconds"] as? Int == 1490)
        #expect(snapshot["paused"] as? Bool == true)
        let json = try JSONSerialization.data(withJSONObject: bridge.bootstrap())
        #expect(!String(decoding: json, as: UTF8.self).contains("accessToken"))
    }
    @Test func failedDiskWriteKeepsReviewAndReportsFailure() async throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        let blocked = folder.appendingPathComponent("not-a-directory")
        try Data("occupied".utf8).write(to: blocked)
        var workspace = LocalWorkspace()
        workspace.timer.start(configuration: workspace.configuration, at: Date().addingTimeInterval(-20))
        workspace.timer.finish(at: Date()); workspace.note = "Keep this review"
        let store = TimerStore(preview: workspace)
        store.file = WorkspaceFile(url: blocked.appendingPathComponent("workspace.json"))
        let bridge = WebBridge(store: store)
        await #expect(throws: (any Error).self) {
            _ = try await bridge.handle(["op": "timer", "action": "discard", "id": workspace.timer.id.uuidString])
        }
        #expect(store.timer.phase == .review)
        #expect(store.workspace.note == "Keep this review")
    }
}
