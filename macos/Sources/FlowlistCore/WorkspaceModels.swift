import Foundation

public struct PlanTask: Codable, Equatable, Identifiable, Sendable {
    public var id: Int
    public var goalId: Int
    public var parentId: Int?
    public var depth: Int
    public var title: String
    public var completed: Bool
    public var position: Int
    public init(id: Int, goalId: Int, parentId: Int? = nil, title: String, position: Int = 0) {
        self.id = id; self.goalId = goalId; self.parentId = parentId
        self.title = title; self.position = position; depth = parentId == nil ? 1 : 2; completed = false
    }
}
public struct PlanProject: Codable, Equatable, Identifiable, Sendable {
    public var id: Int
    public var title: String
    public var goalType: String
    public var completed: Bool
    public var position: Int
    public var tasks: [PlanTask]
    public var description: String?
    public var isExample: Bool?
    public init(id: Int, title: String, goalType: String = "project", position: Int = 0) {
        self.id = id; self.title = title; self.goalType = goalType; self.position = position
        completed = false; tasks = []
    }
    public var roots: [PlanTask] { tasks.filter { $0.parentId == nil }.sorted { $0.position < $1.position } }
    public func children(of task: PlanTask) -> [PlanTask] { tasks.filter { $0.parentId == task.id }.sorted { $0.position < $1.position } }
}

/// Web history identifiers and edit revisions are kept separately from the
/// original timer record so existing local workspaces decode without a migration.
public struct WebHistoryMetadata: Codable, Equatable, Sendable {
    public var id: Int
    public var revision: Int = 0
    public var deletedAt: Date?
    public var attributionIDs: [String: Int] = [:]
    public init(id: Int) { self.id = id }
}
public struct WorkSelection: Codable, Equatable, Identifiable, Sendable {
    public var taskId: Int
    public var title: String
    public var goalTitle: String
    public var completed: Bool
    public var id: Int { taskId }
    public init(task: PlanTask, project: PlanProject, completed: Bool = false) {
        taskId = task.id; title = task.title; goalTitle = project.title; self.completed = completed
    }
}
public struct PlanCache: Codable, Equatable, Sendable {
    public var projects: [PlanProject] = []
    public var priorityIds: [Int] = []
    public var refreshedAt: Date?
    public var lowestAllocatedId: Int?
    public init() {}
    public var lowestLocalId: Int { min(0, lowestAllocatedId ?? 0, (projects.map(\.id) + projects.flatMap { $0.tasks.map(\.id) }).min() ?? 0) }
    public var nextLocalId: Int { lowestLocalId - 1 }
    public var availableTasks: [PlanTask] { projects.filter { !$0.completed }.flatMap(\.tasks).filter { !$0.completed } }
    public mutating func setCompleted(_ id: Int, completed: Bool) {
        guard let gi = projects.firstIndex(where: { $0.tasks.contains { $0.id == id } }),
              let ti = projects[gi].tasks.firstIndex(where: { $0.id == id }) else { return }
        projects[gi].tasks[ti].completed = completed
        if completed {
            for i in projects[gi].tasks.indices where projects[gi].tasks[i].parentId == id { projects[gi].tasks[i].completed = true }
        } else {
            projects[gi].completed = false
            if let parent = projects[gi].tasks[ti].parentId,
               let pi = projects[gi].tasks.firstIndex(where: { $0.id == parent }) { projects[gi].tasks[pi].completed = false }
        }
    }
    public mutating func deleteTask(_ id: Int) {
        for i in projects.indices {
            let removed = projects[i].tasks.filter { $0.id == id || $0.parentId == id }.map(\.id)
            projects[i].tasks.removeAll { removed.contains($0.id) }
            priorityIds.removeAll { removed.contains($0) }
        }
    }
}

public struct RemoteAttribution: Codable, Equatable, Identifiable, Sendable {
    public var id: Int
    public var taskId: Int?
    public var taskTitle: String
    public var goalTitle: String?
    public var completed: Bool
}
public struct RemoteBlock: Codable, Equatable, Sendable {
    public var id: Int
    public var startedAt: Date
    public var endedAt: Date
}
public struct RemoteSession: Codable, Equatable, Identifiable, Sendable {
    public var id: Int
    public var taskTitle: String
    public var summary: String?
    public var actualMinutes: Int
    public var createdAt: Date
    public var startedAt: Date?
    public var endedAt: Date?
    public var revision: Int
    public var blocks: [RemoteBlock]
    public var attributions: [RemoteAttribution]
    public var seconds: TimeInterval { blocks.isEmpty ? Double(actualMinutes * 60) : blocks.reduce(0) { $0 + $1.endedAt.timeIntervalSince($1.startedAt) } }
}

public struct SessionUpload: Encodable, Sendable {
    public struct Block: Encodable, Sendable { public var startedAt: Date; public var endedAt: Date }
    public struct Selection: Encodable, Sendable { public var taskId: Int; public var completed: Bool }
    public let clientId: String
    public let plannedMinutes: Int
    public let actualMinutes: Int
    public let completed = true
    public let summary: String?
    public let startedAt: Date
    public let endedAt: Date
    public let blocks: [Block]
    public let tasks: [Selection]
    public init(session: LocalSession) {
        clientId = session.id.uuidString
        startedAt = Self.wholeSecond(session.startedAt)
        endedAt = Self.wholeSecond(session.endedAt)
        blocks = session.segments.compactMap { segment in
            let start = Self.wholeSecond(segment.startedAt), end = Self.wholeSecond(segment.endedAt)
            return end > start ? Block(startedAt: start, endedAt: end) : nil
        }
        actualMinutes = Int(blocks.reduce(0) { $0 + $1.endedAt.timeIntervalSince($1.startedAt) }) / 60
        plannedMinutes = session.configuration.focusMinutes * max(1, Int(ceil(session.seconds / Double(session.configuration.focusMinutes * 60))))
        summary = session.note.isEmpty ? nil : session.note
        tasks = (session.selections ?? []).map { Selection(taskId: $0.taskId, completed: $0.completed) }
    }
    private static func wholeSecond(_ date: Date) -> Date { Date(timeIntervalSince1970: floor(date.timeIntervalSince1970)) }
}

public enum CloudJSON {
    public static func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        decoder.dateDecodingStrategy = .custom { decoder in
            let value = try decoder.singleValueContainer().decode(String.self)
            let normalized = value.contains("Z") || (value.dropFirst(10).contains("+") || value.dropFirst(10).contains("-")) ? value : value + "Z"
            let format = ISO8601DateFormatter()
            format.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = format.date(from: normalized) { return date }
            format.formatOptions = [.withInternetDateTime]
            if let date = format.date(from: normalized) { return date }
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Invalid server timestamp"))
        }
        return decoder
    }
    public static func encoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }
}

public enum AccountFiles {
    public static func workspaceURL(root: URL, accountId: String?) throws -> URL {
        guard let accountId else { return root.appendingPathComponent("workspace.json") }
        guard let uuid = UUID(uuidString: accountId) else { throw WorkspaceError.unsupportedOrDamaged }
        return root.appendingPathComponent("accounts", isDirectory: true)
            .appendingPathComponent(uuid.uuidString.lowercased(), isDirectory: true).appendingPathComponent("workspace.json")
    }
}
