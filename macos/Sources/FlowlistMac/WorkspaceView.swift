import SwiftUI
import UserNotifications
import ServiceManagement
#if SWIFT_PACKAGE
import FlowlistCore
#endif

struct WorkspaceView: View {
    @EnvironmentObject var store: TimerStore
    @Environment(\.openWindow) private var openWindow
    var body: some View {
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 26) {
                HStack(spacing: 10) { FlowlistMark(); Text("Flowlist").font(.system(size: 22, weight: .semibold)) }.padding(.top, 12)
                VStack(spacing: 6) {
                    ForEach(AppTab.allCases) { tab in
                        Button { store.selectedTab = tab } label: {
                            Label(tab.rawValue, systemImage: tab.symbol).font(.system(size: 14, weight: .medium))
                                .frame(maxWidth: .infinity, alignment: .leading).padding(12)
                                .background(store.selectedTab == tab ? store.theme.tint.opacity(0.14) : .clear, in: RoundedRectangle(cornerRadius: 9))
                                .contentShape(Rectangle())
                        }.buttonStyle(.plain).accessibilityAddTraits(store.selectedTab == tab ? .isSelected : [])
                    }
                }
                Spacer()
                VStack(alignment: .leading, spacing: 12) {
                    Button { store.selectedTab = .settings } label: {
                        Label(store.account?.email ?? "On this Mac", systemImage: store.account == nil ? "internaldrive" : "person.crop.circle")
                            .lineLimit(1).truncationMode(.middle)
                    }.buttonStyle(.plain).help(store.account?.email ?? "Local workspace")
                    if store.account != nil {
                        HStack(spacing: 7) {
                            if store.busy { ProgressView().controlSize(.mini) }
                            else { Image(systemName: store.syncError == nil && store.pendingCount == 0 ? "checkmark.icloud" : "icloud.slash") }
                            Text(store.busy ? "Syncing" : store.pendingCount > 0 ? "\(store.pendingCount) waiting to sync" : store.syncError == nil ? "Connected" : "Sync paused")
                        }.font(.caption).foregroundStyle(.secondary)
                    }
                    Divider()
                    Button(action: openDashboard) { Label("Web dashboard", systemImage: "arrow.up.right.square") }.buttonStyle(.plain).foregroundStyle(.secondary)
                }.font(.callout)
            }.padding(20).frame(width: 184).background(.ultraThinMaterial)
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 26) {
                    HStack {
                        Text(store.selectedTab.rawValue).font(.system(size: 30, weight: .semibold))
                        Spacer()
                        if store.selectedTab == .today { Text(store.now, format: .dateTime.weekday(.wide).month(.abbreviated).day()).foregroundStyle(.secondary).font(.callout) }
                        if store.account != nil {
                            Button { Task { await store.sync() } } label: { Image(systemName: "arrow.clockwise").frame(width: 30, height: 30) }
                                .buttonStyle(.plain).disabled(store.busy).help("Refresh workspace").accessibilityLabel("Refresh workspace")
                        }
                    }
                    if let error = store.error ?? store.syncError {
                        HStack(alignment: .top) {
                            Text(error).font(.callout).fixedSize(horizontal: false, vertical: true)
                            Spacer()
                            Button { store.error = nil; store.syncError = nil } label: { Image(systemName: "xmark") }.buttonStyle(.plain).accessibilityLabel("Dismiss message")
                        }.padding(14).background(.orange.opacity(0.1), in: RoundedRectangle(cornerRadius: 10))
                    }
                    switch store.selectedTab {
                    case .today: today
                    case .plan: PlanView()
                    case .history: HistoryView()
                    case .settings: PreferencesView()
                    }
                }.padding(30).frame(maxWidth: 1150, alignment: .leading).frame(maxWidth: .infinity)
            }.background(Color(nsColor: .windowBackgroundColor))
        }.frame(minWidth: 960, minHeight: 640).tint(store.theme.tint)
        .onAppear {
            AppRouting.openTab = { tab in
                store.selectedTab = tab; openWindow(id: "main")
                NSApplication.shared.activate(ignoringOtherApps: true)
            }
            AppRouting.openToday = {
                store.selectedTab = .today; openWindow(id: "main")
                NSApplication.shared.activate(ignoringOtherApps: true)
            }
            if AppRouting.pending { AppRouting.pending = false; AppRouting.showToday() }
        }
    }
    private var today: some View {
        VStack(alignment: .leading, spacing: 24) {
            if store.timer.phase == .review { ReviewView() } else { FocusCard() }
            if store.showReminderPrompt { ReminderPrompt().frame(maxWidth: .infinity, alignment: .leading) }
            HStack {
                Text("Priorities").font(.title3.weight(.semibold))
                Spacer()
                Button("Open Plan") { store.selectedTab = .plan }.buttonStyle(.link)
            }
            if store.priorities.isEmpty {
                Text("Star tasks in Plan to keep them here.").font(.callout).foregroundStyle(.secondary).padding(.bottom, 16)
            } else {
                VStack(spacing: 0) {
                    ForEach(store.priorities) { task in
                        HStack(spacing: 12) {
                            Button { Task { await store.setCompleted(task, value: true) } } label: { Image(systemName: "square").font(.title3) }.buttonStyle(.plain).accessibilityLabel("Complete \(task.title)")
                            VStack(alignment: .leading, spacing: 4) {
                                Text(task.title)
                                Text(store.project(for: task)?.title ?? "Tasks").font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Menu {
                                Button("Move up") { Task { await store.movePriority(task.id, offset: -1) } }
                                Button("Move down") { Task { await store.movePriority(task.id, offset: 1) } }
                                Button("Remove priority") { Task { await store.prioritize(task) } }
                            } label: { Image(systemName: "ellipsis") }.menuStyle(.borderlessButton).fixedSize().accessibilityLabel("Priority options")
                        }.padding(16)
                        if task.id != store.priorities.last?.id { Divider() }
                    }
                }.background(.background, in: RoundedRectangle(cornerRadius: 14)).disabled(store.busy)
            }
        }
    }
}

struct PreferencesView: View {
    @State private var loginEnabled = SMAppService.mainApp.status == .enabled
    @EnvironmentObject var store: TimerStore
    var body: some View {
        Form {
            Section("Account") {
                if let account = store.account {
                    LabeledContent("Google account", value: account.email)
                    if let last = store.lastSynced { LabeledContent("Last synced") { Text(last, style: .relative) } }
                    HStack {
                        Button("Sync now") { Task { await store.sync() } }.disabled(store.busy)
                        Spacer()
                        Button("Sign out", action: store.disconnect).disabled(!store.canSwitchAccount)
                    }
                } else {
                    Text("Connect your web account to sync projects and focus history. Local-only work stays separate.").font(.callout).foregroundStyle(.secondary)
                    Button("Continue with Google") { Task { await store.connect() } }.disabled(!store.canSwitchAccount)
                }
                if store.connecting { ProgressView("Opening sign-in…").controlSize(.small) }
                if store.timer.phase != .idle { Text("Save or discard the current session before switching accounts.").font(.caption).foregroundStyle(.secondary) }
            }
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
                Toggle("Show landscape artwork", isOn: Binding(get: { store.workspace.showArtwork ?? true }, set: { value in store.change { $0.showArtwork = value } }))
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
            Section("Startup") {
                Toggle("Open Flowlist at login", isOn: Binding(get: { loginEnabled }, set: { value in
                    do {
                        if value { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
                        loginEnabled = SMAppService.mainApp.status == .enabled
                    } catch { store.error = "Couldn’t change login startup. Move Flowlist to Applications and try again." }
                }))
                if SMAppService.mainApp.status == .requiresApproval {
                    Button("Approve in Login Items") { SMAppService.openSystemSettingsLoginItems() }
                }
            }
            Section("Storage") {
                Text("The timer works offline. Signed-in sessions sync when connected; changes to a synced Plan need a connection.")
                    .font(.callout).foregroundStyle(.secondary)
                Button("Open data folder", action: store.openDataFolder)
                Button("Export sessions", action: store.exportSessions).disabled(store.workspace.sessions.isEmpty)
            }
        }.formStyle(.grouped).frame(minHeight: 1050).disabled(store.storageUnavailable)
            .onAppear { store.refreshPermission() }
    }
    private func binding<T>(_ path: WritableKeyPath<LocalWorkspace, T>) -> Binding<T> {
        Binding(get: { store.workspace[keyPath: path] }, set: { value in store.change { $0[keyPath: path] = value } })
    }
}
