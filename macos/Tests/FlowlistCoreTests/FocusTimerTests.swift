import Foundation
import Testing
@testable import FlowlistCore

struct FocusTimerTests {
    let start = Date(timeIntervalSince1970: 1_800_000_000)
    func running() -> FocusTimer {
        var timer = FocusTimer()
        timer.start(configuration: TimerConfiguration(), at: start)
        return timer
    }
    @Test func testFocusAutomaticallyStartsRestWithoutCountingRestAsWork() {
        var timer = running()
        let advanced = timer.reconcile(at: start.addingTimeInterval(1500))
        #expect(advanced)
        #expect(timer.phase == .shortBreak)
        #expect(timer.recordedSeconds == 1500)
        #expect(timer.remaining(at: start.addingTimeInterval(1500)) == 300)
        timer.finish(at: start.addingTimeInterval(1530))
        #expect(timer.recordedSeconds == 1500)
        #expect(timer.phase == .review)
    }
    @Test func testPauseResumeExcludesPausedTime() {
        var timer = running()
        timer.pause(at: start.addingTimeInterval(40))
        #expect(timer.recordedSeconds == 40)
        #expect(timer.remaining(at: start.addingTimeInterval(400)) == 1460)
        timer.resume(at: start.addingTimeInterval(400))
        timer.finish(at: start.addingTimeInterval(430))
        #expect(timer.recordedSeconds == 70)
        #expect(timer.segments.count == 2)
    }
    @Test func testSleepingForDaysCreditsOnlyOneStartedFocusAndWaits() {
        var timer = running()
        timer.reconcile(at: start.addingTimeInterval(86400 * 3))
        #expect(timer.phase == .ready)
        #expect(timer.recordedSeconds == 1500)
        #expect(timer.round == 1)
        let advancedAgain = timer.reconcile(at: start.addingTimeInterval(86400 * 4))
        #expect(!advancedAgain)
        timer.startNext(at: start.addingTimeInterval(86400 * 4))
        #expect(timer.round == 2)
        #expect(timer.phase == .focus)
    }
    @Test func testLastRoundGetsLongBreakAndNextRoundResets() {
        var timer = running()
        timer.round = 4
        timer.reconcile(at: start.addingTimeInterval(1500))
        #expect(timer.phase == .longBreak)
        #expect(timer.remaining(at: start.addingTimeInterval(1500)) == 900)
        timer.reconcile(at: start.addingTimeInterval(2400))
        timer.startNext(at: start.addingTimeInterval(2400))
        #expect(timer.round == 1)
        #expect(timer.recordedSeconds == 1500)
    }
    @Test func testPauseExactlyAtBoundaryPausesBreakNotCompletedFocus() {
        var timer = running()
        timer.pause(at: start.addingTimeInterval(1500))
        #expect(timer.phase == .shortBreak)
        #expect(timer.isPaused)
        #expect(timer.pausedSeconds == 300)
        #expect(timer.recordedSeconds == 1500)
    }
    @Test func testRepeatedActionsCannotDuplicateFocus() {
        var timer = running()
        timer.start(configuration: TimerConfiguration(), at: start.addingTimeInterval(10))
        #expect(timer.startedAt == start)
        timer.finish(at: start.addingTimeInterval(90))
        timer.finish(at: start.addingTimeInterval(120))
        #expect(timer.recordedSeconds == 90)
        #expect(timer.segments.count == 1)
    }
    @Test func testInvalidConfigurationCannotStart() {
        var settings = TimerConfiguration()
        settings.focusMinutes = -1
        var timer = FocusTimer()
        timer.start(configuration: settings, at: start)
        #expect(timer.phase == .idle)
    }
    @Test func testReloadKeepsDeadlineAndPausedState() throws {
        var timer = running()
        var workspace = LocalWorkspace()
        workspace.timer = timer
        var decoded = try JSONDecoder().decode(LocalWorkspace.self, from: JSONEncoder().encode(workspace))
        #expect(decoded.timer.deadline == timer.deadline)
        timer.pause(at: start.addingTimeInterval(12))
        workspace.timer = timer
        decoded = try JSONDecoder().decode(LocalWorkspace.self, from: JSONEncoder().encode(workspace))
        #expect(decoded.timer.isPaused)
        #expect(decoded.timer.recordedSeconds == 12)
    }
    @Test func testSaveSessionIsIdempotentAndPreservesNote() {
        var workspace = LocalWorkspace()
        workspace.timer = running()
        workspace.timer.finish(at: start.addingTimeInterval(7))
        workspace.note = "  Finished reading  "
        workspace.saveSession()
        workspace.saveSession()
        #expect(workspace.sessions.count == 1)
        #expect(workspace.sessions[0].seconds == 7)
        #expect(workspace.sessions[0].note == "Finished reading")
        #expect(workspace.timer.phase == .idle)
    }
    @Test func testZeroDurationCannotCreateSession() {
        var workspace = LocalWorkspace()
        workspace.timer = running()
        workspace.timer.finish(at: start)
        workspace.saveSession()
        #expect(workspace.sessions.isEmpty)
    }
    @Test func testAtomicStorageRoundTripAndInvalidDataNotOverwritten() throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }
        let file = WorkspaceFile(url: folder.appendingPathComponent("workspace.json"))
        var workspace = LocalWorkspace()
        workspace.timer = running()
        try file.save(workspace)
        #expect(try file.load() == workspace)
        let damaged = Data("not-json".utf8)
        try damaged.write(to: file.url)
        #expect(throws: (any Error).self) { try file.load() }
        #expect(try Data(contentsOf: file.url) == damaged)
    }
    @Test func testUnknownSchemaIsRejected() throws {
        var workspace = LocalWorkspace()
        workspace.version = 99
        let file = WorkspaceFile(url: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString))
        #expect(throws: (any Error).self) { try file.save(workspace) }
    }
}
