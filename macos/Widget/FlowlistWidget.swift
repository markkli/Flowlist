import SwiftUI
import WidgetKit

struct FocusEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot
}

struct FocusProvider: TimelineProvider {
    func placeholder(in context: Context) -> FocusEntry {
        FocusEntry(date: Date(), snapshot: WidgetSnapshot(workspace: LocalWorkspace()))
    }
    func getSnapshot(in context: Context, completion: @escaping (FocusEntry) -> Void) {
        completion(FocusEntry(date: Date(), snapshot: load()))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<FocusEntry>) -> Void) {
        let now = Date()
        var snapshot = load()
        snapshot.timer.reconcile(at: now)
        var entries = [FocusEntry(date: now, snapshot: snapshot)]
        // Precompute the current focus -> break -> ready states. Never run a timer
        // in the extension or invent a new focus interval while the app is closed.
        for _ in 0..<2 {
            if let deadline = snapshot.timer.deadline, deadline > now {
                snapshot.timer.reconcile(at: deadline)
                entries.append(FocusEntry(date: deadline, snapshot: snapshot))
            }
        }
        completion(Timeline(entries: entries, policy: .never))
    }
    private func load() -> WidgetSnapshot {
        guard let group = Bundle.main.object(forInfoDictionaryKey: "FlowlistAppGroup") as? String,
              let data = UserDefaults(suiteName: group)?.data(forKey: WidgetSnapshot.key),
              let snapshot = try? JSONDecoder().decode(WidgetSnapshot.self, from: data),
              snapshot.timer.isValid, snapshot.configuration.isValid else {
            return WidgetSnapshot(workspace: LocalWorkspace())
        }
        return snapshot
    }
}

struct FocusWidgetView: View {
    let entry: FocusEntry
    @Environment(\.widgetFamily) private var family
    private var theme: Landscape { Landscape(rawValue: entry.snapshot.theme) ?? .coast }
    private var timer: FocusTimer { entry.snapshot.timer }
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("FLOWLIST").font(.system(size: 10, weight: .semibold)).tracking(1.8)
                Spacer()
                if family == .systemMedium { Text(timer.phase.title).font(.caption) }
            }.foregroundStyle(.white.opacity(0.85))
            Spacer(minLength: 0)
            if timer.phase == .review {
                Text("Session complete").font(.system(size: 22, weight: .medium))
            } else if let deadline = timer.deadline, deadline > entry.date {
                Text(timerInterval: entry.date...deadline, countsDown: true)
                    .font(.system(size: family == .systemSmall ? 38 : 46, weight: .light, design: .rounded))
                    .monospacedDigit()
            } else {
                let settings = timer.phase == .idle ? entry.snapshot.configuration : timer.configuration
                let seconds = timer.isPaused ? timer.pausedSeconds : Double(settings.focusMinutes * 60)
                Text(String(format: "%02d:%02d", Int(ceil(seconds)) / 60, Int(ceil(seconds)) % 60))
                    .font(.system(size: family == .systemSmall ? 38 : 46, weight: .light, design: .rounded)).monospacedDigit()
            }
            HStack {
                Label(timer.phase == .review ? "Review in Today" : "Open timer", systemImage: "arrow.up.right")
                    .font(.system(size: 12, weight: .semibold)).foregroundStyle(theme.accent)
                Spacer(minLength: 0)
                if timer.isPaused { Text("Paused").font(.caption) }
            }
        }
        .foregroundStyle(.white)
        .containerBackground(for: .widget) { LandscapeBackground(theme: theme) }
        .widgetURL(URL(string: "flowlist://today"))
    }
}

@main struct FlowlistWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "FlowlistFocus", provider: FocusProvider()) { entry in FocusWidgetView(entry: entry) }
            .configurationDisplayName("Flowlist")
            .description("Your focus timer, one click away.")
            .supportedFamilies([.systemSmall, .systemMedium])
    }
}
