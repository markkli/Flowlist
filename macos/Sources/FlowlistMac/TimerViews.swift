import SwiftUI

struct FocusCard: View {
    @EnvironmentObject var store: TimerStore
    var compact = false
    var body: some View {
        VStack(alignment: .leading, spacing: compact ? 24 : 36) {
            HStack {
                Circle().fill(store.theme.accent).frame(width: 7, height: 7)
                Text(store.timer.phase.title.uppercased()).font(.system(size: 11, weight: .semibold)).tracking(2)
                Spacer()
                if store.timer.phase != .idle {
                    Text("Round \(store.timer.round) / \(store.timer.configuration.rounds)").font(.caption).foregroundStyle(.white.opacity(0.8))
                }
            }
            HStack(alignment: .center, spacing: 40) {
                VStack(alignment: .leading, spacing: 20) {
                    Text(store.remainingText)
                        .font(.system(size: compact ? 64 : 88, weight: .light, design: .rounded))
                        .monospacedDigit().tracking(-3)
                        .contentTransition(.identity)
                        .accessibilityLabel("\(store.remainingText) remaining\(store.timer.isPaused ? ", paused" : "")")
                    HStack(spacing: 16) {
                        Button(action: store.primaryAction) {
                            Label(store.primaryTitle, systemImage: store.primarySymbol)
                        }.buttonStyle(PrimaryButtonStyle(theme: store.theme)).disabled(store.storageUnavailable)
                        if store.timer.phase != .idle {
                            Button("Finish", action: store.finish)
                                .buttonStyle(.plain).font(.system(size: 13, weight: .medium))
                                .foregroundStyle(.white.opacity(0.9)).padding(.vertical, 12)
                                .accessibilityHint("Review and save this session")
                        }
                    }
                }
                if !compact {
                    Spacer(minLength: 0)
                    configurationSummary
                }
            }
            if compact && store.timer.phase == .idle {
                Text("\(store.workspace.configuration.focusMinutes)m focus  ·  \(store.workspace.configuration.breakMinutes)m rest  ·  \(store.workspace.configuration.rounds) rounds")
                    .font(.caption).foregroundStyle(.white.opacity(0.8))
            } else if store.timer.phase == .ready {
                Text("Break complete. Start when you’re ready.").font(.caption).foregroundStyle(.white.opacity(0.8))
            } else if store.timer.isPaused {
                Text("Paused").font(.caption).foregroundStyle(store.theme.accent)
            }
        }
        .foregroundStyle(.white)
        .padding(compact ? 24 : 36)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(LandscapeBackground(theme: store.theme))
        .clipShape(RoundedRectangle(cornerRadius: compact ? 16 : 24))
        .overlay(RoundedRectangle(cornerRadius: compact ? 16 : 24).strokeBorder(.white.opacity(0.12)))
    }
    private var configurationSummary: some View {
        let settings = store.timer.phase == .idle ? store.workspace.configuration : store.timer.configuration
        return Grid(alignment: .leading, horizontalSpacing: 28, verticalSpacing: 22) {
            GridRow { metric("Focus", value: "\(settings.focusMinutes) min"); metric("Rounds", value: "\(settings.rounds)") }
            GridRow { metric("Short rest", value: "\(settings.breakMinutes) min"); metric("Long rest", value: "\(settings.longBreakMinutes) min") }
        }
        .padding(.leading, 24)
        .overlay(alignment: .leading) { Rectangle().fill(.white.opacity(0.18)).frame(width: 1) }
    }
    private func metric(_ title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.caption).foregroundStyle(.white.opacity(0.75))
            Text(value).font(.system(size: 18, weight: .medium)).monospacedDigit()
        }
    }
}

struct ReviewView: View {
    @EnvironmentObject var store: TimerStore
    @State private var confirmDiscard = false
    var compact = false
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("SESSION COMPLETE").font(.system(size: 10, weight: .semibold)).tracking(2).foregroundStyle(.secondary)
                    Text("Save your progress").font(.system(size: compact ? 23 : 30, weight: .semibold))
                }
                Spacer()
            }
            Text("\(focusDuration(store.timer.recordedSeconds)) focused").foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 8) {
                Text("Note").font(.headline)
                TextEditor(text: Binding(get: { store.workspace.note }, set: { value in store.change { $0.note = value } }))
                    .font(.body).scrollContentBackground(.hidden)
                    .padding(8).frame(height: compact ? 86 : 120)
                    .background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 10))
                    .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(.secondary.opacity(0.3)))
                    .accessibilityLabel("Optional session note")
            }
            HStack {
                Button("Discard") { confirmDiscard = true }.buttonStyle(.plain).foregroundStyle(.secondary)
                Spacer()
                Button("Save session", action: store.saveSession)
                    .buttonStyle(PrimaryButtonStyle(theme: store.theme))
                    .disabled(store.timer.recordedSeconds < 1 || store.storageUnavailable)
            }
            Text(store.timer.recordedSeconds < 1 ? "No focus time recorded." : "Saved on this Mac. Cloud sync is not connected yet.")
                .font(.caption).foregroundStyle(.secondary)
        }
        .padding(compact ? 20 : 28)
        .background(.background, in: RoundedRectangle(cornerRadius: 20))
        .confirmationDialog("Discard this session and note?", isPresented: $confirmDiscard) {
            Button("Discard session", role: .destructive, action: store.discard)
        }
    }
}

struct MenuPanel: View {
    @EnvironmentObject var store: TimerStore
    @Environment(\.openWindow) private var openWindow
    var body: some View {
        VStack(spacing: 12) {
            HStack {
                Text("Flowlist").font(.system(size: 15, weight: .semibold))
                Spacer()
                Button { open(.settings) } label: { Image(systemName: "slider.horizontal.3").frame(width: 28, height: 28) }
                    .buttonStyle(.plain).help("Settings").accessibilityLabel("Settings")
            }.padding(.horizontal, 8)
            if store.timer.phase == .review { ReviewView(compact: true) }
            else { FocusCard(compact: true) }
            if store.showReminderPrompt { ReminderPrompt() }
            HStack {
                Button { open(.today) } label: { Label("Open Today", systemImage: "macwindow") }
                    .buttonStyle(.plain)
                Spacer()
                Menu {
                    Button("Local history") { open(.history) }
                    Button("Web dashboard") { openDashboard() }
                    Divider()
                    Button("Quit Flowlist") { NSApplication.shared.terminate(nil) }
                } label: { Image(systemName: "ellipsis").frame(width: 28, height: 28) }
                    .menuStyle(.borderlessButton).fixedSize().accessibilityLabel("More options")
            }.font(.system(size: 12)).padding(.horizontal, 8)
            if let error = store.error { Text(error).font(.caption).foregroundStyle(.red).textSelection(.enabled) }
        }
        .padding(14).frame(width: 364)
    }
    private func open(_ tab: AppTab) {
        store.selectedTab = tab
        openWindow(id: "main")
        NSApplication.shared.activate(ignoringOtherApps: true)
    }
}

struct ReminderPrompt: View {
    @EnvironmentObject var store: TimerStore
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Image(systemName: "bell.badge").font(.system(size: 28)).foregroundStyle(store.theme.accent)
            Text("Know when to take a break").font(.title2.weight(.semibold))
            Text("Get a notification and a gentle chime when focus or rest ends. Your timer is already running.").foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            HStack {
                Button("Not now", action: store.dismissReminders)
                Spacer()
                Button("Enable reminders", action: store.enableReminders).buttonStyle(.borderedProminent)
            }
        }.padding(24).frame(width: 330)
    }
}

func openDashboard() {
    NSWorkspace.shared.open(URL(string: "https://flowlist-beta.onrender.com/#goals")!)
}
