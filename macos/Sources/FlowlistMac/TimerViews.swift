import SwiftUI
#if SWIFT_PACKAGE
import FlowlistCore
#endif

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
                        }.buttonStyle(PrimaryButtonStyle(theme: store.theme)).disabled(store.storageUnavailable || store.connecting)
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
        .background(LandscapeBackground(theme: store.theme, showArtwork: store.workspace.showArtwork ?? true))
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
    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            HStack {
                Text("Save your progress").font(.system(size: 28, weight: .semibold))
                Spacer()
                Text(focusDuration(store.timer.recordedSeconds)).foregroundStyle(.secondary)
            }
            NoteField(note: Binding(get: { store.workspace.note }, set: { value in store.change { $0.note = value } }))
            Text("**Worked on** records progress. **Finished** also checks it off in Plan.")
                .font(.callout).foregroundStyle(.secondary)
            WorkChecklist(projects: store.plan.projects, selections: store.workspace.selections ?? [], unfinishedOnly: true) { task, finished, value in
                store.selectWork(task, finished: finished, value: value)
            }
            HStack {
                Button("Discard", role: .destructive) { confirmDiscard = true }.buttonStyle(.plain)
                Spacer()
                Button("Save session", action: store.saveSession).buttonStyle(PrimaryButtonStyle(theme: store.theme))
                    .disabled(store.timer.recordedSeconds < 1 || store.workspace.note.count > 2000 || store.storageUnavailable)
            }
            if store.timer.recordedSeconds < 1 { Text("No focus time recorded.").font(.caption).foregroundStyle(.secondary) }
        }
        .padding(28).background(.background, in: RoundedRectangle(cornerRadius: 20))
        .confirmationDialog("Discard this session and note?", isPresented: $confirmDiscard) {
            Button("Discard session", role: .destructive, action: store.discard)
        }
    }
}

private final class PanelWindowReference { weak var window: NSWindow? }
private struct PanelWindowReader: NSViewRepresentable {
    let reference: PanelWindowReference
    final class Reader: NSView {
        var reference: PanelWindowReference?
        override func viewDidMoveToWindow() { super.viewDidMoveToWindow(); reference?.window = window }
    }
    func makeNSView(context: Context) -> Reader { let view = Reader(); view.reference = reference; return view }
    func updateNSView(_ view: Reader, context: Context) { reference.window = view.window }
}

struct MenuPanel: View {
    @State private var panelWindow = PanelWindowReference()
    @EnvironmentObject var store: TimerStore
    @Environment(\.openWindow) private var openWindow
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        VStack(spacing: 20) {
            HStack {
                Text("Flowlist").font(.system(size: 14, weight: .semibold, design: .serif))
                Spacer()
                Button { open(.settings) } label: { Image(systemName: "slider.horizontal.3").frame(width: 28, height: 28) }
                    .buttonStyle(.plain).help("Settings").accessibilityLabel("Settings")
            }
            if store.timer.phase == .review {
                VStack(spacing: 12) {
                    Image(systemName: "checkmark.circle").font(.system(size: 32, weight: .light)).foregroundStyle(store.theme.tint)
                    Text("Ready to save").font(.title3.weight(.medium))
                    Text("\(focusDuration(store.timer.recordedSeconds)) focused").font(.callout).foregroundStyle(.secondary)
                }.frame(height: 150)
                Button("Review in app") { open(.today) }.buttonStyle(PrimaryButtonStyle(theme: store.theme))
            } else {
                ZStack {
                    Circle().strokeBorder(.secondary.opacity(0.15), lineWidth: 3)
                    Circle().trim(from: 0, to: progress).stroke(store.theme.tint, style: StrokeStyle(lineWidth: 3, lineCap: .round)).rotationEffect(.degrees(-90))
                    VStack(spacing: 6) {
                        Text(store.remainingText).font(.system(size: 43, weight: .light, design: .rounded)).monospacedDigit().tracking(-1.5)
                        Text(store.timer.isPaused ? "Paused" : store.timer.phase.title).font(.system(size: 12)).foregroundStyle(.secondary)
                    }
                }.frame(width: 164, height: 164).accessibilityElement(children: .combine)
                HStack(spacing: 6) {
                    ForEach(1...settings.rounds, id: \.self) { round in
                        Circle().fill(round <= store.timer.round && store.timer.phase != .idle ? store.theme.tint : Color.secondary.opacity(0.2)).frame(width: 5, height: 5)
                    }
                    Text("\(store.timer.phase == .idle ? settings.rounds : store.timer.round) \(store.timer.phase == .idle ? "rounds" : "of \(settings.rounds)")")
                        .font(.caption).foregroundStyle(.secondary).padding(.leading, 4)
                }.accessibilityLabel("Round \(store.timer.round) of \(settings.rounds)")
                HStack(spacing: 12) {
                    Button { store.primaryAction() } label: {
                        Label(store.primaryTitle, systemImage: store.primarySymbol).frame(maxWidth: .infinity)
                    }.buttonStyle(PrimaryButtonStyle(theme: store.theme)).disabled(store.storageUnavailable || store.connecting)
                    if store.timer.phase != .idle {
                        Button("Finish") { store.finish(); open(.today) }.buttonStyle(.plain).font(.callout)
                    }
                }
            }
            if store.showReminderPrompt {
                Button("Enable reminders", action: store.enableReminders).buttonStyle(.link).font(.caption)
            }
            Divider()
            HStack {
                Button { open(.today) } label: { Label("Open Flowlist", systemImage: "macwindow") }.buttonStyle(.plain)
                Spacer()
                Menu {
                    Button("Plan") { open(.plan) }
                    Button("History") { open(.history) }
                    Divider()
                    Button("Quit Flowlist") { NSApplication.shared.terminate(nil) }
                } label: { Image(systemName: "ellipsis") }.menuStyle(.borderlessButton).fixedSize().accessibilityLabel("More options")
            }.font(.system(size: 12)).foregroundStyle(.secondary)
            if store.error != nil { Button("View issue in app") { open(.today) }.buttonStyle(.link).font(.caption) }
        }.padding(20).frame(width: 320).background(Color(nsColor: .windowBackgroundColor)).tint(store.theme.tint)
            .background(PanelWindowReader(reference: panelWindow).frame(width: 0, height: 0))
    }
    private var settings: TimerConfiguration { store.timer.phase == .idle ? store.workspace.configuration : store.timer.configuration }
    private var progress: Double {
        if store.timer.phase == .idle { return 1 }
        let minutes = store.timer.phase == .focus ? settings.focusMinutes : store.timer.phase == .longBreak ? settings.longBreakMinutes : settings.breakMinutes
        return min(1, max(0, store.timer.remaining(at: store.now) / Double(minutes * 60)))
    }
    private func open(_ tab: AppTab) {
        panelWindow.window?.orderOut(nil)
        dismiss()
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
