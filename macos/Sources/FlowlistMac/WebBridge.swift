import AppKit
import Foundation
import UserNotifications
#if SWIFT_PACKAGE
import FlowlistCore
#endif

/// The bundled page owns presentation; native code owns credentials, files and the clock.
@MainActor final class WebBridge {
    let store: TimerStore
    lazy var api = WebWorkspaceAPI(store: store)
    var openSettings: (() -> Void)?
    init(store: TimerStore) { self.store = store }

    private var preferenceKey: String { "flowlist.web.preferences." + (store.account?.id ?? "local") }
    var preferences: [String: Any] {
        UserDefaults.standard.dictionary(forKey: preferenceKey) ?? [
            "appearance": ["preset": store.workspace.theme, "focusArtwork": store.workspace.showArtwork ?? true, "planArtwork": true],
            "theme": NSApp?.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? "dark" : "light"
        ]
    }
    func settings(_ configuration: TimerConfiguration) -> [String: Any] {
        ["focus": configuration.focusMinutes, "break": configuration.breakMinutes,
         "rounds": configuration.rounds, "longBreak": configuration.longBreakMinutes]
    }
    func timerSnapshot() -> Any {
        let timer = store.timer
        guard timer.phase != .idle else { return NSNull() }
        let now = Date()
        let duration = timer.phase == .shortBreak ? timer.configuration.breakMinutes
            : timer.phase == .longBreak ? timer.configuration.longBreakMinutes : timer.configuration.focusMinutes
        return [
            "id": timer.id.uuidString, "nativePhase": timer.phase.rawValue,
            "phase": timer.phase == .review ? "awaiting-attribution" : timer.phase == .focus ? "focus" : "break",
            "paused": timer.isPaused, "remainingSeconds": Int(ceil(timer.remaining(at: now))),
            "elapsedSeconds": Int(timer.recordedSeconds), "round": timer.round,
            "settings": settings(timer.configuration),
            "deadline": (timer.deadline ?? now.addingTimeInterval(timer.remaining(at: now))).timeIntervalSince1970 * 1000,
            "blockSeconds": duration * 60, "breakKind": timer.round >= timer.configuration.rounds ? "long" : "short",
            "minimized": true, "summary": store.workspace.note,
            "selections": (store.workspace.selections ?? []).map { ["task_id": $0.taskId, "completed": $0.completed] as [String: Any] },
            "startedAt": (timer.startedAt ?? now).timeIntervalSince1970 * 1000,
            "endedAt": timer.endedAt.map { $0.timeIntervalSince1970 * 1000 } as Any? ?? NSNull(),
            "blocks": timer.segments.map { ["started_at": Self.iso($0.startedAt), "ended_at": Self.iso($0.endedAt)] },
            "draftTask": "", "draftDestination": "__tasks__", "draftGroup": "", "draftGroupType": "project"
        ] as [String: Any]
    }
    func bootstrap() -> [String: Any] {
        ["account": store.account.map { ["id": $0.id, "email": $0.email] } as Any? ?? NSNull(),
         "needsSignIn": store.account == nil && !UserDefaults.standard.bool(forKey: "flowlist.welcome.seen") && store.workspace.sessions.isEmpty && store.plan.projects.isEmpty && store.workspace.webOnboardingVersion == nil,
         "planPendingCount": store.workspace.planOutbox?.count ?? 0,
         "planSyncIssue": store.workspace.planOutbox?.first?.error as Any? ?? NSNull(),
         "planSyncUncertain": store.workspace.planOutbox?.first?.uncertain == true,
         "onboarding": ["version": store.workspace.webOnboardingVersion as Any? ?? NSNull()],
         "timer": timerSnapshot(), "settings": settings(store.workspace.configuration), "preferences": preferences,
         "notifications": store.permission == .notDetermined ? "default" : store.permission == .denied ? "denied" : "granted",
         "sound": store.workspace.soundEnabled, "reminderPromptSeen": store.workspace.reminderPromptSeen,
         "showReminderPrompt": store.showReminderPrompt, "syncing": store.busy,
         "pendingRecords": store.workspace.sessions.filter { $0.needsUpload == true }.map { session in
             ["id": session.id.uuidString, "title": session.selections?.first?.title ?? "General focus",
              "seconds": Int(session.seconds), "endedAt": Self.iso(session.endedAt), "note": session.note,
              "error": session.uploadError as Any? ?? NSNull(), "errorCode": session.uploadErrorCode as Any? ?? NSNull()] as [String: Any]
         },
         "pendingCount": store.pendingCount, "error": (store.error ?? store.syncError) as Any? ?? NSNull()]
    }
    func handle(_ message: [String: Any]) async throws -> Any {
        guard let operation = message["op"] as? String else { throw invalid() }
        switch operation {
        case "bootstrap": return bootstrap()
        case "api":
            guard let path = message["path"] as? String, let method = message["method"] as? String else { throw invalid() }
            let body = message["body"] as? [String: Any]
            if path == "/sessions", method == "POST" { return try saveSession(body) }
            return try await api.request(path: path, method: method, body: body)
        case "timer": return try timerCommand(message)
        case "appearance":
            var next = preferences
            if let appearance = message["appearance"] as? [String: Any], let preset = appearance["preset"] as? String,
               ["coast", "grove", "hills", "linen", "sage", "slate", "clay"].contains(preset),
               let focus = appearance["focusArtwork"] as? Bool, let plan = appearance["planArtwork"] as? Bool {
                next["appearance"] = ["preset": preset, "focusArtwork": focus, "planArtwork": plan]
                // Native compact surfaces use the same palette; solid presets omit artwork.
                guard store.change({ $0.theme = preset; $0.showArtwork = focus }) else { throw saveFailure() }
            }
            if let theme = message["theme"] as? String, ["light", "dark"].contains(theme) { next["theme"] = theme }
            UserDefaults.standard.set(next, forKey: preferenceKey)
            return next
        case "reminders":
            switch message["action"] as? String {
            case "enable": await store.requestReminders()
            case "dismiss": store.dismissReminders()
            case "sound":
                guard let value = message["sound"] as? Bool, store.change({ $0.soundEnabled = value }) else { throw invalid() }
            case "settings": NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.Notifications-Settings.extension")!)
            default: throw invalid()
            }
            return bootstrap()
        case "account":
            switch message["action"] as? String {
            case "connect":
                await store.connect()
                if let error = store.error { throw CloudFailure(message: error) }
            case "disconnect":
                guard store.canSwitchAccount else { throw CloudFailure(message: "Save or discard your current session before signing out.") }
                store.disconnect()
            case "continueLocal": UserDefaults.standard.set(true, forKey: "flowlist.welcome.seen")
            case "retryPlan": try await store.retryPlanChanges(confirmUncertain: message["confirmUncertain"] as? Bool == true)
            case "sync": await store.sync()
            case "settings": openSettings?()
            default: throw invalid()
            }
            return bootstrap()
        case "outbox":
            switch message["action"] as? String {
            case "retry": await store.sync()
            case "general":
                guard !store.busy, let value = message["id"] as? String, let id = UUID(uuidString: value),
                      store.workspace.sessions.contains(where: { $0.id == id && $0.needsUpload == true }) else { throw invalid() }
                store.savePendingAsGeneral(id)
            default: throw invalid()
            }
            return bootstrap()
        case "download":
            guard let name = message["filename"] as? String, let text = message["text"] as? String,
                  text.utf8.count < 50_000_000 else { throw invalid() }
            let panel = NSSavePanel()
            panel.nameFieldStringValue = URL(fileURLWithPath: name).lastPathComponent
            if panel.runModal() == .OK, let url = panel.url {
                try Data(text.utf8).write(to: url, options: .atomic)
                return ["saved": true]
            }
            return ["saved": false]
        default: throw invalid()
        }
    }
    private func timerCommand(_ message: [String: Any]) throws -> Any {
        guard !store.storageUnavailable, !store.connecting, let action = message["action"] as? String else { throw saveFailure() }
        let now = Date()
        if ["pause", "resume", "skip", "finish"].contains(action), !matchesTimer(message) { throw invalid() }
        switch action {
        case "start":
            if [.idle, .ready].contains(store.timer.phase) {
                store.primaryAction()
                guard store.timer.phase == .focus else { throw saveFailure() }
            }
        case "pause":
            if store.timer.isActive && !store.timer.isPaused {
                store.primaryAction()
                guard store.timer.isPaused || store.timer.phase == .ready else { throw saveFailure() }
            }
        case "resume":
            if store.timer.isPaused { store.primaryAction(); guard !store.timer.isPaused else { throw saveFailure() } }
        case "skip": guard store.change({ $0.timer.skip(at: now) }) else { throw saveFailure() }
        case "finish": store.finish(); guard store.timer.phase == .review else { throw saveFailure() }
        case "discard":
            guard store.timer.phase == .review, matchesTimer(message) else { throw invalid() }
            store.discard()
            guard store.timer.phase == .idle else { throw saveFailure() }
        case "settings":
            guard let values = message["settings"] as? [String: Any],
                  let focus = values["focus"] as? Int, let rest = values["break"] as? Int,
                  let long = values["longBreak"] as? Int, let rounds = values["rounds"] as? Int else { throw invalid() }
            var config = TimerConfiguration()
            config.focusMinutes = focus; config.breakMinutes = rest; config.longBreakMinutes = long; config.rounds = rounds
            guard config.isValid else { throw invalid() }
            guard store.change({ $0.configuration = config }) else { throw saveFailure() }
        case "draft":
            guard store.timer.phase == .review, matchesTimer(message),
                  let summary = message["summary"] as? String, summary.count <= 2000,
                  let selections = message["selections"] as? [[String: Any]], selections.count <= 300 else { throw invalid() }
            var work: [WorkSelection] = []
            for rawValue in selections {
                let value = store.translatePlanRequest(path: "", body: rawValue).1
                guard let id = value["task_id"] as? Int, let completed = value["completed"] as? Bool,
                      !work.contains(where: { $0.taskId == id }),
                      let project = store.plan.projects.first(where: { $0.tasks.contains { $0.id == id } }),
                      let task = project.tasks.first(where: { $0.id == id }) else {
                    throw CloudFailure(message: "A selected task is no longer available. Reopen the review to update your selection.", status: 404)
                }
                work.append(WorkSelection(task: task, project: project, completed: completed))
            }
            guard store.change({ $0.note = summary; $0.selections = work }) else { throw saveFailure() }
        default: throw invalid()
        }
        return timerSnapshot()
    }
    private func saveSession(_ body: [String: Any]?) throws -> Any {
        guard let id = body?["client_id"] as? String, let uuid = UUID(uuidString: id) else { throw invalid() }
        if let saved = store.workspace.sessions.first(where: { $0.id == uuid }) {
            return ["client_id": saved.id.uuidString, "saved": true]
        }
        guard store.timer.id == uuid, store.timer.phase == .review else { throw invalid() }
        guard store.timer.recordedSeconds >= 1 else { throw CloudFailure(message: "There is no focus time to save. Discard this session to close it.", status: 422) }
        // The page cannot forge time or a different session; save the native persisted draft.
        store.saveSession()
        guard store.workspace.sessions.contains(where: { $0.id == uuid }) else { throw saveFailure() }
        return ["client_id": id, "saved": true]
    }
    private func matchesTimer(_ value: [String: Any]) -> Bool {
        guard let id = value["id"] as? String else { return false }
        return UUID(uuidString: id) == store.timer.id
    }
    private func invalid() -> CloudFailure { CloudFailure(message: "This action is no longer available. Please try again.", status: 400) }
    private func saveFailure() -> CloudFailure { CloudFailure(message: store.error ?? "Couldn’t save on this Mac. Try again.", status: 503) }
    static func iso(_ value: Date) -> String { ISO8601DateFormatter().string(from: value) }
}
