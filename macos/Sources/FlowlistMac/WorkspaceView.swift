import SwiftUI
import UserNotifications
#if SWIFT_PACKAGE
import FlowlistCore
#endif

struct WorkspaceView: View {
    @EnvironmentObject var store: TimerStore
    @Environment(\.openWindow) private var openWindow
    var body: some View {
        NavigationSplitView {
            VStack(alignment: .leading, spacing: 24) {
                HStack(spacing: 10) {
                    FlowlistMark()
                    Text("Flowlist").font(.system(size: 22, weight: .semibold))
                }.padding(.horizontal, 16).padding(.top, 24)
                List(selection: $store.selectedTab) {
                    ForEach(AppTab.allCases) { tab in
                        Label(tab.rawValue, systemImage: tab.symbol).tag(tab).padding(.vertical, 5)
                    }
                }.listStyle(.sidebar)
                VStack(alignment: .leading, spacing: 14) {
                    Button(action: openDashboard) { Label("Open web dashboard", systemImage: "arrow.up.right.square") }
                        .buttonStyle(.plain).font(.callout)
                    Label("On this Mac", systemImage: "internaldrive").font(.caption).foregroundStyle(.secondary)
                }.padding(18)
            }
            .navigationSplitViewColumnWidth(min: 190, ideal: 210, max: 250)
        } detail: {
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    HStack {
                        Text(store.selectedTab.rawValue).font(.system(size: 32, weight: .semibold))
                        Spacer()
                        if store.selectedTab == .today {
                            Text(store.now, format: .dateTime.weekday(.wide).month(.abbreviated).day())
                                .foregroundStyle(.secondary).font(.callout)
                        }
                    }
                    if let error = store.error {
                        VStack(alignment: .leading, spacing: 10) {
                            Text(error).foregroundStyle(.red)
                            if store.storageUnavailable { Button("Open data folder", action: store.openDataFolder) }
                            else { Button("Dismiss") { store.error = nil } }
                        }.padding().frame(maxWidth: .infinity, alignment: .leading)
                            .background(.red.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
                    }
                    switch store.selectedTab {
                    case .today: today
                    case .history: HistoryView()
                    case .settings: PreferencesView()
                    }
                }.padding(32).frame(maxWidth: 1100, alignment: .leading).frame(maxWidth: .infinity)
            }
            .background(Color(nsColor: .windowBackgroundColor))
        }
        .frame(minWidth: 960, minHeight: 640)
        .onOpenURL { url in
            if url.scheme == "flowlist", url.host == "today" {
                store.selectedTab = .today
                openWindow(id: "main")
                NSApplication.shared.activate(ignoringOtherApps: true)
            }
        }
        .onAppear {
            AppRouting.openToday = {
                store.selectedTab = .today
                openWindow(id: "main")
                NSApplication.shared.activate(ignoringOtherApps: true)
            }
            if AppRouting.pending { AppRouting.pending = false; AppRouting.showToday() }
        }
    }
    private var today: some View {
        VStack(alignment: .leading, spacing: 24) {
            if store.timer.phase == .review { ReviewView() }
            else { FocusCard() }
            if store.showReminderPrompt { ReminderPrompt().frame(maxWidth: .infinity, alignment: .leading) }
            HStack(alignment: .top, spacing: 24) {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Today’s focus").font(.headline)
                    Text(focusDuration(todaySeconds)).font(.system(size: 28, weight: .medium, design: .rounded))
                    Text("\(todayCount) saved \(todayCount == 1 ? "session" : "sessions")").font(.caption).foregroundStyle(.secondary)
                }.frame(maxWidth: .infinity, alignment: .leading)
                VStack(alignment: .leading, spacing: 10) {
                    Text("Your workspace").font(.headline)
                    Text("Projects and priorities are on the web dashboard.").font(.callout).foregroundStyle(.secondary)
                    Button("Open Plan", action: openDashboard).buttonStyle(.link)
                }.frame(maxWidth: .infinity, alignment: .leading)
            }.padding(24).background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: 16))
            Text("Local preview · Sessions stay on this Mac. Cloud sync is coming next.")
                .font(.caption).foregroundStyle(.secondary)
        }
    }
    private var todayCount: Int { store.workspace.sessions.filter { Calendar.current.isDateInToday($0.endedAt) }.count }
    private var todaySeconds: TimeInterval { store.workspace.sessions.filter { Calendar.current.isDateInToday($0.endedAt) }.reduce(0) { $0 + $1.seconds } }
}

struct HistoryView: View {
    @EnvironmentObject var store: TimerStore
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                Text("Saved on this Mac").foregroundStyle(.secondary)
                Spacer()
                Button("Export sessions", action: store.exportSessions).disabled(store.workspace.sessions.isEmpty)
            }
            if store.workspace.sessions.isEmpty {
                ContentUnavailableView("Your focus history starts here", systemImage: "clock", description: Text("Finish and save a session to see it here."))
                    .frame(maxWidth: .infinity).padding(.vertical, 60)
            }
            ForEach(store.workspace.sessions) { session in
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Text(focusDuration(session.seconds)).font(.headline)
                        Spacer()
                        Text(session.endedAt, format: .dateTime.month(.abbreviated).day().hour().minute()).font(.callout).foregroundStyle(.secondary)
                    }
                    Text(session.note.isEmpty ? "General focus" : session.note).foregroundStyle(.secondary).textSelection(.enabled)
                }.padding(20).frame(maxWidth: .infinity, alignment: .leading)
                    .background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: 14))
            }
        }
    }
}

struct PreferencesView: View {
    @EnvironmentObject var store: TimerStore
    var body: some View {
        Form {
            Section("Timer") {
                Stepper("Focus: \(store.workspace.configuration.focusMinutes) minutes", value: binding(\.configuration.focusMinutes), in: 5...120, step: 5)
                Stepper("Short break: \(store.workspace.configuration.breakMinutes) minutes", value: binding(\.configuration.breakMinutes), in: 1...60)
                Stepper("Long break: \(store.workspace.configuration.longBreakMinutes) minutes", value: binding(\.configuration.longBreakMinutes), in: 5...90, step: 5)
                Stepper("Rounds: \(store.workspace.configuration.rounds)", value: binding(\.configuration.rounds), in: 2...8)
                Text("Changes apply to your next session. Breaks start automatically; the next focus starts when you’re ready.").font(.caption).foregroundStyle(.secondary)
            }
            Section("Appearance") {
                Picker("Landscape", selection: binding(\.theme)) {
                    ForEach(Landscape.allCases) { theme in Text(theme.title).tag(theme.rawValue) }
                }
                Toggle("Show countdown in menu bar", isOn: binding(\.showMenuTime))
            }
            Section("Reminders") {
                Toggle("Chime at the end of focus and breaks", isOn: binding(\.soundEnabled))
                HStack {
                    Text("Notifications")
                    Spacer()
                    switch store.permission {
                    case .authorized, .provisional, .ephemeral: Text("Enabled").foregroundStyle(.secondary)
                    case .denied:
                        Button("Open System Settings") { NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.Notifications-Settings.extension")!) }
                    default: Button("Enable…", action: store.enableReminders)
                    }
                }
            }
            Section("Storage") {
                Text("This preview works offline. Your timer, notes, and history are stored on this Mac, separately from your web account.")
                    .font(.callout).foregroundStyle(.secondary)
                Button("Open data folder", action: store.openDataFolder)
                Button("Export sessions", action: store.exportSessions).disabled(store.workspace.sessions.isEmpty)
            }
        }.formStyle(.grouped).frame(minHeight: 690).disabled(store.storageUnavailable)
            .onAppear { store.refreshPermission() }
    }
    private func binding<T>(_ path: WritableKeyPath<LocalWorkspace, T>) -> Binding<T> {
        Binding(get: { store.workspace[keyPath: path] }, set: { value in store.change { $0[keyPath: path] = value } })
    }
}
