import SwiftUI
#if SWIFT_PACKAGE
import FlowlistCore
#endif

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
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        VStack(spacing: 20) {
            HStack {
                Text("Flowlist").font(.system(size: 14, weight: .semibold, design: .serif))
                Spacer()
                Button {
                    open(.today, review: false)
                    AppRouting.webAction("flowlist:native-timer-settings")
                } label: { Image(systemName: "slider.horizontal.3").frame(width: 28, height: 28) }
                    .buttonStyle(.plain).help("Timer settings").accessibilityLabel("Timer settings")
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
    private func open(_ tab: AppTab, review: Bool = true) {
        panelWindow.window?.orderOut(nil)
        dismiss()
        store.selectedTab = tab
        AppRouting.showTab(tab)
        if tab == .today && review && store.timer.phase == .review {
            AppRouting.webAction("flowlist:native-open-timer")
        }
        NSApplication.shared.activate(ignoringOtherApps: true)
    }
}

func openDashboard() {
    NSWorkspace.shared.open(URL(string: "https://flowlist-beta.onrender.com/#goals")!)
}
