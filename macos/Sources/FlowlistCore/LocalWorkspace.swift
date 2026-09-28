import Foundation

public struct LocalWorkspace: Codable, Equatable, Sendable {
    public var version = 1
    public var timer = FocusTimer()
    public var configuration = TimerConfiguration()
    public var sessions: [LocalSession] = []
    public var note = ""
    public var theme = "coast"
    public var soundEnabled = true
    public var showMenuTime = true
    public var reminderPromptSeen = false
    public init() {}
    public var isValid: Bool {
        version == 1 && configuration.isValid && timer.isValid
        && ["coast", "grove", "hills"].contains(theme)
        && sessions.allSatisfy { $0.endedAt >= $0.startedAt && $0.configuration.isValid }
    }
    public mutating func saveSession() {
        guard let session = LocalSession(timer: timer, note: note) else { return }
        if !sessions.contains(where: { $0.id == session.id }) { sessions.insert(session, at: 0) }
        timer = FocusTimer()
        note = ""
    }
}

public enum WorkspaceError: Error { case unsupportedOrDamaged }

/// Atomic replacement keeps a crash from leaving half-written timer/history data.
/// Invalid existing data is surfaced to the UI, never silently replaced.
public struct WorkspaceFile {
    public let url: URL
    public init(url: URL) { self.url = url }
    public func load() throws -> LocalWorkspace {
        guard FileManager.default.fileExists(atPath: url.path) else { return LocalWorkspace() }
        let data = try Data(contentsOf: url)
        let workspace = try JSONDecoder().decode(LocalWorkspace.self, from: data)
        guard workspace.isValid else { throw WorkspaceError.unsupportedOrDamaged }
        return workspace
    }
    public func save(_ workspace: LocalWorkspace) throws {
        guard workspace.isValid else { throw WorkspaceError.unsupportedOrDamaged }
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let data = try JSONEncoder().encode(workspace)
        try data.write(to: url, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }
}

/// The signed app publishes this read-only snapshot to its WidgetKit extension.
public struct WidgetSnapshot: Codable, Sendable {
    public var timer: FocusTimer
    public var configuration: TimerConfiguration
    public var theme: String
    public init(workspace: LocalWorkspace) {
        timer = workspace.timer
        configuration = workspace.configuration
        theme = workspace.theme
    }
    public static let key = "flowlist.widget.snapshot.v1"
}
