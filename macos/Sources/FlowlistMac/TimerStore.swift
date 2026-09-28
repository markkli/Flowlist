import AppKit
import Combine
import UserNotifications
import WidgetKit
import Network
#if SWIFT_PACKAGE
import FlowlistCore
#endif

@MainActor final class TimerStore: ObservableObject {
    @Published var workspace = LocalWorkspace()
    @Published var now = Date()
    @Published var error: String?
    @Published var permission: UNAuthorizationStatus = .notDetermined
    @Published var showReminderPrompt = false
    @Published var selectedTab = AppTab.today
    @Published var storageUnavailable = false
    var file: WorkspaceFile?
    var rootFolder: URL?
    let cloud: CloudClient
    @Published var account: CloudIdentity?
    @Published var busy = false
    @Published var connecting = false
    @Published var syncError: String?
    @Published var lastSynced: Date?
    @Published var historyHasMore = true
    var lastSyncAttempt = Date.distantPast
    private var pulse: AnyCancellable?
    private var activation: AnyCancellable?
    private lazy var reminders = Reminders()
    private var previewMode = false
    private var wakeObserver: NSObjectProtocol?
    private let network = NWPathMonitor()

    init(preview: LocalWorkspace? = nil, client: CloudClient? = nil) {
        cloud = client ?? CloudClient()
        if let preview {
            previewMode = true
            workspace = preview
            file = nil
            return
        }
        let folder = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Flowlist", isDirectory: true)
        rootFolder = folder
        var accountId: String?
        do {
            try cloud.restore()
            account = cloud.identity
            accountId = account?.id
        } catch { self.error = error.localizedDescription }
        let file = WorkspaceFile(url: (try? AccountFiles.workspaceURL(root: folder, accountId: accountId)) ?? folder.appendingPathComponent("workspace.json"))
        self.file = file
        do { workspace = try file.load() }
        catch {
            workspace = LocalWorkspace()
            storageUnavailable = true
            self.error = "Flowlist couldn’t read its local data. Your file has been left untouched. Open the data folder to recover it, then restart the app."
        }
        reminders.center.delegate = reminders
        refreshPermission()
        tick()
        refreshReminders()
        publishWidget()
        Task { await sync() }
        network.pathUpdateHandler = { [weak self] path in
            if path.status == .satisfied { Task { @MainActor in self?.refreshIfNeeded() } }
        }
        network.start(queue: DispatchQueue(label: "dev.flowlist.connection"))
        pulse = Timer.publish(every: 1, on: .main, in: .common).autoconnect().sink { [weak self] _ in self?.tick() }
        activation = NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)
            .sink { [weak self] _ in self?.refreshPermission(); self?.refreshIfNeeded() }
        wakeObserver = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didWakeNotification, object: nil, queue: .main
        ) { [weak self] _ in Task { @MainActor in self?.tick() } }
    }
    deinit { network.cancel(); if let wakeObserver { NSWorkspace.shared.notificationCenter.removeObserver(wakeObserver) } }
    var timer: FocusTimer { workspace.timer }
    var theme: Landscape { Landscape(rawValue: workspace.theme) ?? .coast }
    var remainingText: String {
        let value = timer.phase == .idle ? TimeInterval(workspace.configuration.focusMinutes * 60) : timer.remaining(at: now)
        let seconds = max(0, Int(ceil(value)))
        return String(format: "%02d:%02d", seconds / 60, seconds % 60)
    }
    var primaryTitle: String {
        if timer.phase == .review { return "Review session" }
        if timer.isPaused { return "Resume" }
        if timer.isActive { return "Pause" }
        return "Start focus"
    }
    var primarySymbol: String { timer.isActive && !timer.isPaused ? "pause.fill" : "play.fill" }
    @discardableResult func change(_ update: (inout LocalWorkspace) -> Void) -> Bool {
        guard !storageUnavailable else { return false }
        var next = workspace
        update(&next)
        do {
            try file?.save(next)
            let timerChanged = workspace.timer != next.timer
            let soundChanged = workspace.soundEnabled != next.soundEnabled
            let widgetChanged = timerChanged || workspace.theme != next.theme || workspace.configuration != next.configuration || workspace.showArtwork != next.showArtwork
            workspace = next
            if timerChanged || soundChanged { refreshReminders() }
            if widgetChanged { publishWidget() }
            return true
        } catch {
            self.error = "Couldn’t save on this Mac. Check free disk space and folder permissions, then try again."
            return false
        }
    }
    func primaryAction() {
        guard !connecting else { return }
        now = Date()
        if timer.phase == .review { selectedTab = .today; return }
        change { state in
            if state.timer.phase == .idle { state.timer.start(configuration: state.configuration, at: now) }
            else if state.timer.phase == .ready { state.timer.startNext(at: now) }
            else if state.timer.isPaused { state.timer.resume(at: now) }
            else { state.timer.pause(at: now) }
        }
        if timer.isActive && !workspace.reminderPromptSeen {
            Task {
                let settings = await reminders.center.notificationSettings()
                permission = settings.authorizationStatus
                if permission == .notDetermined { showReminderPrompt = true }
                else { change { $0.reminderPromptSeen = true } }
            }
        }
    }
    func finish() { now = Date(); change { $0.timer.finish(at: now) }; selectedTab = .today }
    func saveSession() {
        guard !connecting, workspace.note.count <= 2000 else { return }
        if change({ $0.saveSession(upload: account != nil) }) { Task { await sync() } }
    }
    func discard() { change { $0.timer = FocusTimer(); $0.note = ""; $0.selections = [] } }
    func tick() {
        let current = Date()
        // Idle/paused surfaces do not need to redraw once per second.
        if (timer.isActive && !timer.isPaused) || !Calendar.current.isDate(current, inSameDayAs: now) { now = current }
        let previous = timer
        var next = previous
        if next.reconcile(at: current) {
            change { $0.timer = next }
            // System notifications handle sound when authorized, including background use.
            // This local fallback covers an open/running app without notification permission.
            if timer != previous, workspace.soundEnabled, permission != .authorized,
               let deadline = previous.deadline, now.timeIntervalSince(deadline) < 10 {
                NSSound(named: "Glass")?.play()
            }
        }
    }
    func enableReminders() {
        showReminderPrompt = false
        change { $0.reminderPromptSeen = true }
        Task {
            do {
                _ = try await reminders.center.requestAuthorization(options: [.alert, .sound])
                await updatePermission()
                refreshReminders()
            } catch { self.error = "Notifications couldn’t be enabled. You can retry in Settings." }
        }
    }
    func dismissReminders() { showReminderPrompt = false; change { $0.reminderPromptSeen = true } }
    func refreshPermission() { Task { await updatePermission() } }
    private func updatePermission() async {
        permission = await reminders.center.notificationSettings().authorizationStatus
        if permission != .notDetermined {
            showReminderPrompt = false
            if !workspace.reminderPromptSeen { change { $0.reminderPromptSeen = true } }
        }
        refreshReminders()
    }
    func refreshReminders() {
        guard file != nil, !previewMode else { return } // View previews never schedule notifications.
        reminders.schedule(timer: timer, sound: workspace.soundEnabled)
    }
    func publishWidget() {
        // The unsigned local package has no shared app group. It never claims widget support.
        guard let group = Bundle.main.object(forInfoDictionaryKey: "FlowlistAppGroup") as? String,
              !group.isEmpty, !group.contains("$("),
              let shared = UserDefaults(suiteName: group),
              let encoded = try? JSONEncoder().encode(WidgetSnapshot(workspace: workspace)) else { return }
        shared.set(encoded, forKey: WidgetSnapshot.key)
        WidgetCenter.shared.reloadTimelines(ofKind: "FlowlistFocus")
    }
    func openDataFolder() {
        if let file { NSWorkspace.shared.selectFile(file.url.path, inFileViewerRootedAtPath: file.url.deletingLastPathComponent().path) }
    }
    func exportSessions() {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = "Flowlist-sessions.json"
        panel.allowedContentTypes = [.json]
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do {
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            encoder.dateEncodingStrategy = .iso8601
            try encoder.encode(workspace.sessions).write(to: url, options: .atomic)
        } catch { self.error = "Couldn’t export sessions to that location." }
    }
}

final class Reminders: NSObject, UNUserNotificationCenterDelegate {
    let center = UNUserNotificationCenter.current()
    private let identifiers = ["flowlist.focus-ended", "flowlist.break-ended"]
    func schedule(timer: FocusTimer, sound: Bool) {
        // Keep the just-due request intact at a phase boundary: removing it here
        // can race the system delivery and make the reminder disappear.
        if timer.phase == .ready { return }
        guard timer.isActive, let deadline = timer.deadline else {
            center.removePendingNotificationRequests(withIdentifiers: identifiers)
            return
        }
        if timer.phase == .focus {
            let rest = timer.round >= timer.configuration.rounds ? timer.configuration.longBreakMinutes : timer.configuration.breakMinutes
            add(id: identifiers[0], title: "Time for a break", body: "Your focus interval is complete. Rest for \(rest) minutes.", date: deadline, sound: sound)
            add(id: identifiers[1], title: "Ready for another focus?", body: "Your break is over. Start when you’re ready.", date: deadline.addingTimeInterval(Double(rest * 60)), sound: sound)
        } else {
            add(id: identifiers[1], title: "Ready for another focus?", body: "Your break is over. Start when you’re ready.", date: deadline, sound: sound)
        }
    }
    private func add(id: String, title: String, body: String, date: Date, sound: Bool) {
        let delay = date.timeIntervalSinceNow
        guard delay > 0 else { return }
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        if sound { content.sound = .default }
        let request = UNNotificationRequest(identifier: id, content: content, trigger: UNTimeIntervalNotificationTrigger(timeInterval: max(1, delay), repeats: false))
        center.add(request)
    }
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        DispatchQueue.main.async { AppRouting.showToday() }
        completionHandler()
    }
}

@MainActor enum AppRouting {
    // Keep a scene action after the main window closes, so widget deep links and
    // notification clicks can reopen it while only the menu bar is present.
    static var openToday: (() -> Void)?
    static var openTab: ((AppTab) -> Void)?
    static func showTab(_ tab: AppTab) { openTab?(tab) }
    static var pending = false
    static func showToday() {
        if let openToday { openToday() } else { pending = true }
    }
}
enum AppTab: String, CaseIterable, Identifiable {
    case today = "Today", plan = "Plan", history = "History", settings = "Settings"
    var id: String { rawValue }
    var symbol: String { switch self { case .today: "timer"; case .plan: "checklist"; case .history: "calendar"; case .settings: "slider.horizontal.3" } }
}
