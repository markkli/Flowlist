import Foundation

public struct LocalWorkspace: Codable, Equatable, Sendable {
    public var version = 1
    public var timer = FocusTimer()
    public var configuration = TimerConfiguration()
    public var sessions: [LocalSession] = []
    public var note = ""
    public var theme = "coast"
    public var showArtwork: Bool?
    public var soundEnabled = true
    public var showMenuTime = true
    public var reminderPromptSeen = false
    public var planOutbox: [PlanChange]?
    public var planIDAliases: [String: Int]?
    public var planRevision: Int?
    public var plan: PlanCache?
    public var selections: [WorkSelection]?
    public var cloudHistory: [RemoteSession]?
    public var webOnboardingVersion: Int?
    public var webCacheOwner: String?
    public var webResponseCache: [String: Data]?
    public var webHistoryMetadata: [String: WebHistoryMetadata]?
    public init() {}
    public var planForEditing: PlanCache {
        var result = plan ?? PlanCache()
        let referenced = (sessions.flatMap { ($0.selections ?? []).map(\.taskId) } + (selections ?? []).map(\.taskId)).min() ?? 0
        result.lowestAllocatedId = min(result.lowestLocalId, referenced)
        return result
    }
    /// Never reuse a deleted local ID: saved history intentionally keeps task
    /// snapshots and must not attach them to unrelated work created later.
    public mutating func preserveLocalIdentifiers(from previous: LocalWorkspace) {
        var cache = planForEditing
        cache.lowestAllocatedId = min(cache.lowestLocalId, previous.planForEditing.lowestLocalId)
        plan = cache
    }
    public var isValid: Bool {
        version == 1 && configuration.isValid && timer.isValid
        && ["coast", "grove", "hills", "linen", "sage", "slate", "clay"].contains(theme)
        && sessions.allSatisfy { $0.endedAt >= $0.startedAt && $0.configuration.isValid }
    }
    public mutating func saveSession(upload: Bool = false) {
        var work = selections ?? []
        for project in plan?.projects ?? [] {
            let completedParents = Set(work.filter(\.completed).map(\.taskId))
            for task in project.tasks where task.parentId.map({ completedParents.contains($0) }) == true {
                if let i = work.firstIndex(where: { $0.taskId == task.id }) { work[i].completed = true }
                else { work.append(WorkSelection(task: task, project: project, completed: true)) }
            }
        }
        guard let session = LocalSession(timer: timer, note: note, selections: work, upload: upload) else { return }
        if !sessions.contains(where: { $0.id == session.id }) { sessions.insert(session, at: 0) }
        for selection in work where selection.completed { plan?.setCompleted(selection.taskId, completed: true) }
        timer = FocusTimer()
        note = ""
        selections = []
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
    public var showArtwork: Bool?
    public init(workspace: LocalWorkspace) {
        timer = workspace.timer
        configuration = workspace.configuration
        theme = workspace.theme
        showArtwork = workspace.showArtwork
    }
    public static let key = "flowlist.widget.snapshot.v1"
}
