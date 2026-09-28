import Foundation

public struct TimerConfiguration: Codable, Equatable, Sendable {
    public var focusMinutes = 25
    public var breakMinutes = 5
    public var longBreakMinutes = 15
    public var rounds = 4
    public init() {}
    public var isValid: Bool {
        (5...120).contains(focusMinutes) && (1...60).contains(breakMinutes)
        && (5...90).contains(longBreakMinutes) && (2...8).contains(rounds)
    }
}

public enum FocusPhase: String, Codable, Sendable {
    case idle, focus, shortBreak, longBreak, ready, review
    public var title: String {
        switch self {
        case .idle, .focus: return "Focus"
        case .shortBreak: return "Short break"
        case .longBreak: return "Long break"
        case .ready: return "Ready to focus"
        case .review: return "Session complete"
        }
    }
}

public struct FocusSegment: Codable, Equatable, Sendable {
    public var startedAt: Date
    public var endedAt: Date
    public var seconds: TimeInterval { max(0, endedAt.timeIntervalSince(startedAt)) }
}

/// One timer shared by every app surface. No timer ticks are written to disk.
/// Deadlines survive suspension; elapsed sleep never fabricates future focus rounds.
public struct FocusTimer: Codable, Equatable, Sendable {
    public var id = UUID()
    public var phase: FocusPhase = .idle
    public var configuration = TimerConfiguration()
    public var round = 1
    public var startedAt: Date?
    public var endedAt: Date?
    public var deadline: Date?
    public var segmentStartedAt: Date?
    public var pausedSeconds: TimeInterval = 0
    public var segments: [FocusSegment] = []
    public init() {}

    public var isActive: Bool { [.focus, .shortBreak, .longBreak].contains(phase) }
    public var isPaused: Bool { isActive && deadline == nil }
    public var recordedSeconds: TimeInterval { segments.reduce(0) { $0 + $1.seconds } }
    public var isValid: Bool {
        configuration.isValid && (1...configuration.rounds).contains(round)
        && pausedSeconds.isFinite && pausedSeconds >= 0
        && segments.allSatisfy { $0.endedAt >= $0.startedAt }
        && (phase == .idle || startedAt != nil)
        && (segmentStartedAt == nil || (phase == .focus && deadline != nil))
    }
    public func remaining(at now: Date) -> TimeInterval {
        if let deadline { return max(0, deadline.timeIntervalSince(now)) }
        if isPaused { return pausedSeconds }
        return TimeInterval(configuration.focusMinutes * 60)
    }
    public func focusedSeconds(at now: Date) -> TimeInterval {
        guard phase == .focus, let start = segmentStartedAt, let deadline else { return recordedSeconds }
        return recordedSeconds + max(0, min(now, deadline).timeIntervalSince(start))
    }

    public mutating func start(configuration: TimerConfiguration, at now: Date) {
        guard phase == .idle, configuration.isValid else { return }
        self = FocusTimer()
        self.configuration = configuration
        startedAt = now
        beginFocus(at: now)
    }
    public mutating func startNext(at now: Date) {
        guard phase == .ready else { return }
        round = round >= configuration.rounds ? 1 : round + 1
        beginFocus(at: now)
    }
    private mutating func beginFocus(at now: Date) {
        phase = .focus
        deadline = now.addingTimeInterval(TimeInterval(configuration.focusMinutes * 60))
        segmentStartedAt = now
        pausedSeconds = 0
    }
    private mutating func recordFocus(until date: Date) {
        if let start = segmentStartedAt, date > start {
            segments.append(FocusSegment(startedAt: start, endedAt: date))
        }
        segmentStartedAt = nil
    }
    /// A break starts automatically. Its end waits for an explicit Start focus.
    @discardableResult public mutating func reconcile(at now: Date) -> Bool {
        guard let end = deadline, now >= end else { return false }
        if phase == .focus {
            recordFocus(until: end)
            phase = round >= configuration.rounds ? .longBreak : .shortBreak
            let minutes = phase == .longBreak ? configuration.longBreakMinutes : configuration.breakMinutes
            deadline = end.addingTimeInterval(TimeInterval(minutes * 60))
        }
        if [.shortBreak, .longBreak].contains(phase), let end = deadline, now >= end {
            phase = .ready
            deadline = nil
        }
        return true
    }
    public mutating func pause(at now: Date) {
        reconcile(at: now)
        guard isActive, let end = deadline else { return }
        pausedSeconds = max(0, end.timeIntervalSince(now))
        if phase == .focus { recordFocus(until: min(now, end)) }
        deadline = nil
    }
    public mutating func resume(at now: Date) {
        guard isPaused else { return }
        deadline = now.addingTimeInterval(pausedSeconds)
        if phase == .focus { segmentStartedAt = now }
        pausedSeconds = 0
    }
    /// Skipping records only work already performed, never the remainder of a block.
    public mutating func skip(at now: Date) {
        guard isActive else { return }
        let previousPhase = phase
        reconcile(at: now)
        guard phase == previousPhase else { return }
        if phase == .focus {
            if let end = deadline { recordFocus(until: min(now, end)) }
            phase = round >= configuration.rounds ? .longBreak : .shortBreak
            let minutes = phase == .longBreak ? configuration.longBreakMinutes : configuration.breakMinutes
            deadline = now.addingTimeInterval(Double(minutes * 60))
        } else {
            phase = .ready
            deadline = nil
        }
        pausedSeconds = 0
    }
    public mutating func finish(at now: Date) {
        guard ![.idle, .review].contains(phase) else { return }
        reconcile(at: now)
        if phase == .focus, let end = deadline { recordFocus(until: min(now, end)) }
        deadline = nil
        segmentStartedAt = nil
        endedAt = now
        phase = .review
    }
}

public struct LocalSession: Codable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let startedAt: Date
    public let endedAt: Date
    public let segments: [FocusSegment]
    public var note: String
    public let configuration: TimerConfiguration
    public var selections: [WorkSelection]?
    public var needsUpload: Bool?
    public var remoteId: Int?
    public var uploadError: String?
    public var uploadErrorCode: Int?
    public var seconds: TimeInterval { segments.reduce(0) { $0 + $1.seconds } }
    public init?(timer: FocusTimer, note: String, selections: [WorkSelection] = [], upload: Bool = false) {
        guard timer.phase == .review, timer.recordedSeconds >= 1,
              let startedAt = timer.startedAt, let endedAt = timer.endedAt else { return nil }
        id = timer.id
        self.startedAt = startedAt
        self.endedAt = endedAt
        segments = timer.segments
        self.note = note.trimmingCharacters(in: .whitespacesAndNewlines)
        configuration = timer.configuration
        self.selections = selections
        needsUpload = upload
    }
}
