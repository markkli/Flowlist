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
        WebWorkspaceView(store: store, openSettings: { openWindow(id: "mac-settings") })
            .frame(minWidth: 900, minHeight: 640)
            .onAppear {
                AppRouting.openTab = { tab in
                    store.selectedTab = tab
                    if tab == .settings { openWindow(id: "mac-settings") }
                    else {
                        openWindow(id: "main")
                        NotificationCenter.default.post(name: .flowlistNavigate, object: tab)
                    }
                    NSApplication.shared.activate(ignoringOtherApps: true)
                }
                AppRouting.openToday = {
                    openWindow(id: "main")
                    NotificationCenter.default.post(name: .flowlistNavigate, object: AppTab.today)
                    NSApplication.shared.activate(ignoringOtherApps: true)
                }
                if AppRouting.pending { AppRouting.pending = false; AppRouting.showToday() }
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
            Section("Menu bar & startup") {
                Toggle("Show countdown in menu bar", isOn: binding(\.showMenuTime))
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
                Text("Plan edits and sessions save on this Mac and sync in the background. Uncached history and changes to cloud records need a connection.")
                    .font(.callout).foregroundStyle(.secondary)
                Button("Open data folder", action: store.openDataFolder)
                Button("Export sessions", action: store.exportSessions).disabled(store.workspace.sessions.isEmpty)
            }
        }.formStyle(.grouped).frame(minHeight: 660).disabled(store.storageUnavailable)
            .onAppear { store.refreshPermission() }
    }
    private func binding<T>(_ path: WritableKeyPath<LocalWorkspace, T>) -> Binding<T> {
        Binding(get: { store.workspace[keyPath: path] }, set: { value in store.change { $0[keyPath: path] = value } })
    }
}
