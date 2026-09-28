import SwiftUI
#if SWIFT_PACKAGE
import FlowlistCore
#endif

struct HistoryRecord: Identifiable {
    var local: LocalSession?
    var remote: RemoteSession?
    var id: String { remote.map { "remote-\($0.id)" } ?? local!.id.uuidString }
    var date: Date { remote?.startedAt ?? remote?.createdAt ?? local!.startedAt }
    var seconds: TimeInterval { remote?.seconds ?? local!.seconds }
    var title: String { remote?.taskTitle ?? local?.selections?.first?.title ?? "General focus" }
    var note: String { remote?.summary ?? local?.note ?? "" }
    var blocks: [(Date, Date)] {
        if let remote { return remote.blocks.map { ($0.startedAt, $0.endedAt) } }
        return local?.segments.map { ($0.startedAt, $0.endedAt) } ?? []
    }
}
private struct HistoryWeek: Decodable { var sessions: [RemoteSession] }

struct HistoryView: View {
    @EnvironmentObject var store: TimerStore
    @State private var endDate = Calendar.current.startOfDay(for: Date())
    @State private var weekSessions: [RemoteSession] = []
    @State private var loading = false
    @State private var weekError: String?
    @State private var selected: HistoryRecord?
    @State private var pendingGeneral: UUID?
    private var days: [Date] { (-6...0).map { Calendar.current.date(byAdding: .day, value: $0, to: endDate)! } }
    private var localRecords: [HistoryRecord] { store.workspace.sessions.filter { store.account == nil || $0.remoteId == nil }.map { HistoryRecord(local: $0) } }
    private var calendarRecords: [HistoryRecord] {
        localRecords + (store.account == nil ? [] : weekSessions.map { HistoryRecord(remote: $0) })
    }
    private var list: [HistoryRecord] {
        (localRecords + (store.workspace.cloudHistory ?? []).map { HistoryRecord(remote: $0) }).sorted { $0.date > $1.date }
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack(spacing: 14) {
                Text("\(days[0].formatted(.dateTime.month(.abbreviated).day())) – \(endDate.formatted(.dateTime.month(.abbreviated).day()))").font(.headline)
                if loading { ProgressView().controlSize(.small) }
                Spacer()
                Button { move(-7) } label: { Image(systemName: "chevron.left") }.accessibilityLabel("Previous seven days")
                Button("Today") { endDate = Calendar.current.startOfDay(for: Date()) }
                Button { move(7) } label: { Image(systemName: "chevron.right") }.disabled(Calendar.current.isDateInToday(endDate)).accessibilityLabel("Next seven days")
            }
            if let weekError {
                HStack { Text(weekError).font(.caption); Button("Retry") { Task { await loadWeek() } } }.foregroundStyle(.secondary)
            }
            FocusCalendar(days: days, records: calendarRecords, select: { selected = $0 })
            HStack {
                Text("Sessions").font(.title3.weight(.semibold))
                Spacer()
                Button("Export local sessions", action: store.exportSessions).disabled(store.workspace.sessions.isEmpty)
            }
            if list.isEmpty { Text("Your saved focus sessions will appear here.").foregroundStyle(.secondary).padding(.vertical, 24) }
            ForEach(list) { record in
                VStack(alignment: .leading, spacing: 8) {
                    Button { selected = record } label: {
                        HStack(spacing: 16) {
                            VStack(alignment: .leading, spacing: 6) {
                                Text(record.title).font(.headline)
                                Text(record.date, format: .dateTime.month(.abbreviated).day().hour().minute()).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text(focusDuration(record.seconds)).font(.callout).foregroundStyle(.secondary)
                            Image(systemName: "chevron.right").font(.caption).foregroundStyle(.secondary)
                        }.contentShape(Rectangle())
                    }.buttonStyle(.plain)
                    if let session = record.local, session.needsUpload == true {
                        HStack {
                            Label(session.uploadError == nil ? "Waiting to sync" : "Not synced", systemImage: "icloud.and.arrow.up").font(.caption).foregroundStyle(.secondary)
                            Spacer()
                            if session.uploadErrorCode == 404 { Button("Save as General focus") { pendingGeneral = session.id }.font(.caption) }
                            else { Button("Retry") { Task { await store.sync() } }.font(.caption) }
                        }.disabled(store.busy)
                        if let reason = session.uploadError { Text(reason).font(.caption).foregroundStyle(.secondary) }
                    }
                }.padding(18).background(.background, in: RoundedRectangle(cornerRadius: 12))
            }
            if store.account != nil && store.historyHasMore {
                Button("Load older sessions") { Task { await store.loadOlderHistory() } }.disabled(store.busy)
            }
        }
        .task(id: endDate) { await loadWeek() }
        .onChange(of: store.lastSynced) { Task { await loadWeek() } }
        .sheet(item: $selected, onDismiss: { Task { await loadWeek() } }) { RecordEditor(record: $0).environmentObject(store) }
        .confirmationDialog("Save this session without task links? Its note and focus time will be kept.", isPresented: Binding(get: { pendingGeneral != nil }, set: { if !$0 { pendingGeneral = nil } })) {
            Button("Save as General focus") { if let id = pendingGeneral { store.savePendingAsGeneral(id) }; pendingGeneral = nil }
        }
    }
    private func move(_ days: Int) {
        endDate = min(Calendar.current.startOfDay(for: Date()), Calendar.current.date(byAdding: .day, value: days, to: endDate)!)
    }
    private func loadWeek() async {
        guard let owner = store.account?.id else { return }
        let date = endDate
        let formatter = DateFormatter(); formatter.dateFormat = "yyyy-MM-dd"; formatter.locale = Locale(identifier: "en_US_POSIX")
        let zone = TimeZone.current.identifier.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "UTC"
        loading = true; weekError = nil
        do {
            let result: HistoryWeek = try await store.cloud.request("/history/week?start=\(formatter.string(from: days[0]))&timezone=\(zone)", owner: owner)
            guard store.account?.id == owner, date == endDate, !Task.isCancelled else { return }
            weekSessions = result.sessions
        } catch {
            if date == endDate && !Task.isCancelled { weekSessions = []; weekError = "Couldn’t load this week. Local sessions are still shown." }
        }
        if date == endDate { loading = false }
    }
}

private struct CalendarBlock: Identifiable {
    let id: String
    let record: HistoryRecord
    let start: Double
    let duration: Double
    var lane = 0
}
struct FocusCalendar: View {
    @EnvironmentObject var store: TimerStore
    let days: [Date]
    let records: [HistoryRecord]
    let select: (HistoryRecord) -> Void
    @State private var briefDay: Date?
    private let hourHeight: CGFloat = 48
    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                Color.clear.frame(width: 40)
                ForEach(days, id: \.self) { day in
                    VStack(spacing: 6) {
                        Text(day, format: .dateTime.weekday(.abbreviated)).font(.caption).foregroundStyle(.secondary)
                        Text(day, format: .dateTime.day()).font(.system(size: 18, weight: .medium)).foregroundStyle(Calendar.current.isDateInToday(day) ? store.theme.tint : .primary)
                        let brief = briefRecords(day)
                        Button(brief.isEmpty ? "—" : "\(brief.count) brief") { briefDay = day }
                            .buttonStyle(.plain).font(.system(size: 11)).foregroundStyle(.secondary).disabled(brief.isEmpty)
                            .help("Brief sessions and records without a timed block")
                    }.frame(maxWidth: .infinity).padding(.vertical, 12)
                }
            }
            Divider()
            ScrollViewReader { proxy in
                ScrollView(.vertical) {
                    HStack(alignment: .top, spacing: 0) {
                        VStack(spacing: 0) {
                            ForEach(0..<24) { hour in
                                Text(String(format: "%02d", hour)).font(.system(size: 10)).foregroundStyle(.secondary).frame(width: 40, height: hourHeight, alignment: .top).id(hour)
                            }
                        }
                        ForEach(days, id: \.self) { day in dayColumn(day) }
                    }.frame(height: hourHeight * 24)
                }.frame(height: 350).onAppear { proxy.scrollTo(8, anchor: .top) }
            }
        }.background(.background, in: RoundedRectangle(cornerRadius: 14)).clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(.secondary.opacity(0.2)))
        .popover(isPresented: Binding(get: { briefDay != nil }, set: { if !$0 { briefDay = nil } })) {
            VStack(alignment: .leading, spacing: 12) {
                Text("Brief & untimed sessions").font(.headline)
                if let day = briefDay {
                    ForEach(briefRecords(day)) { record in
                        Button { briefDay = nil; select(record) } label: {
                            HStack { Text(record.title); Spacer(); Text(focusDuration(record.seconds)).foregroundStyle(.secondary) }
                        }.buttonStyle(.plain)
                    }
                }
            }.padding(20).frame(width: 310)
        }
    }
    private func briefRecords(_ day: Date) -> [HistoryRecord] { records.filter { ($0.seconds < 300 || $0.blocks.isEmpty) && Calendar.current.isDate($0.date, inSameDayAs: day) } }
    private func blocks(_ day: Date) -> [CalendarBlock] {
        let end = Calendar.current.date(byAdding: .day, value: 1, to: day)!
        var result: [CalendarBlock] = []
        for record in records where record.seconds >= 300 {
            for (i, interval) in record.blocks.enumerated() {
                let start = max(day, interval.0), finish = min(end, interval.1)
                guard finish > start else { continue }
                // Local wall-clock placement keeps the grid aligned across DST days.
                let components = Calendar.current.dateComponents([.hour, .minute, .second], from: start)
                let minute = Double((components.hour ?? 0) * 60 + (components.minute ?? 0)) + Double(components.second ?? 0) / 60
                result.append(CalendarBlock(id: "\(record.id)-\(i)", record: record, start: minute, duration: min(1440 - minute, finish.timeIntervalSince(start) / 60)))
            }
        }
        result.sort { $0.start < $1.start }
        var lanes: [Double] = []
        for i in result.indices {
            let lane = lanes.firstIndex(where: { $0 <= result[i].start }) ?? lanes.count
            if lane == lanes.count { lanes.append(0) }
            result[i].lane = lane; lanes[lane] = result[i].start + result[i].duration
        }
        return result
    }
    private func dayColumn(_ day: Date) -> some View {
        let entries = blocks(day)
        let count = max(1, (entries.map(\.lane).max() ?? 0) + 1)
        return GeometryReader { geometry in
            ZStack(alignment: .topLeading) {
                VStack(spacing: 0) { ForEach(0..<24) { _ in Rectangle().fill(.clear).frame(height: hourHeight).overlay(alignment: .top) { Rectangle().fill(.secondary.opacity(0.15)).frame(height: 1) } } }
                Rectangle().fill(.secondary.opacity(0.15)).frame(width: 1)
                ForEach(entries) { entry in
                    Button { select(entry.record) } label: {
                        RoundedRectangle(cornerRadius: 3).fill(store.theme.tint.opacity(0.24))
                            .overlay(alignment: .leading) { RoundedRectangle(cornerRadius: 2).fill(store.theme.tint).frame(width: 2) }
                            .overlay(alignment: .topLeading) {
                                if entry.duration >= 30 { Text(entry.record.title).font(.system(size: 10)).lineLimit(2).padding(4) }
                            }
                    }.buttonStyle(.plain)
                        .frame(width: max(1, geometry.size.width / Double(count) - 4), height: max(1, entry.duration * hourHeight / 60))
                        .offset(x: Double(entry.lane) * geometry.size.width / Double(count) + 2, y: entry.start * hourHeight / 60)
                        .help("\(entry.record.title) · \(focusDuration(entry.record.seconds))").accessibilityLabel("\(entry.record.title), \(focusDuration(entry.record.seconds))")
                }
            }
        }.frame(maxWidth: .infinity)
    }
}

struct RecordEditor: View {
    @EnvironmentObject var store: TimerStore
    @Environment(\.dismiss) private var dismiss
    let record: HistoryRecord
    @State private var note = ""
    @State private var selections: [WorkSelection] = []
    @State private var savedAttributions: [RemoteAttribution] = []
    @State private var confirmDelete = false
    @State private var saving = false
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 5) {
                    Text("Focus record").font(.title2.weight(.semibold))
                    Text("\(record.date.formatted(date: .abbreviated, time: .shortened)) · \(focusDuration(record.seconds))").font(.callout).foregroundStyle(.secondary)
                }
                Spacer()
                Button { dismiss() } label: { Image(systemName: "xmark").frame(width: 28, height: 28) }.buttonStyle(.plain).accessibilityLabel("Close record")
            }.padding(24)
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    NoteField(note: $note).disabled(record.local?.needsUpload == true)
                    Text("These choices update this record, not your checklist in Plan.").font(.callout).foregroundStyle(.secondary)
                    ForEach(savedAttributions.filter { item in item.taskId == nil || !store.plan.projects.flatMap(\.tasks).contains(where: { $0.id == item.taskId }) }) { item in
                        HStack { Text(item.taskTitle); Spacer(); Text(item.completed ? "Finished" : "Worked on").foregroundStyle(.secondary) }.font(.callout)
                    }
                    WorkChecklist(projects: store.plan.projects, selections: selections, inheritCompletion: false) { task, finished, value in
                        guard let project = store.project(for: task) else { return }
                        if let i = selections.firstIndex(where: { $0.taskId == task.id }) {
                            if finished { selections[i].completed = value } else if !value { selections.remove(at: i) }
                        } else if value { selections.append(WorkSelection(task: task, project: project, completed: finished)) }
                    }.disabled(record.local?.needsUpload == true)
                    if record.local?.needsUpload == true { Text("Sync this session before editing it.").font(.callout).foregroundStyle(.secondary) }
                    if let error = store.error { Text(error).font(.caption).foregroundStyle(.red) }
                }.padding(24)
            }
            Divider()
            HStack {
                Button("Delete session…", role: .destructive) { confirmDelete = true }.buttonStyle(.plain).disabled(record.local?.needsUpload == true || store.busy)
                Spacer()
                Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Save changes") { save() }.keyboardShortcut(.defaultAction).disabled(note.count > 2000 || store.busy || saving || record.local?.needsUpload == true)
            }.padding(24)
        }.frame(width: 720, height: 650).background(Color(nsColor: .windowBackgroundColor)).tint(store.theme.tint).disabled(saving)
        .onAppear {
            note = record.note
            if let remote = record.remote {
                savedAttributions = remote.attributions
                selections = remote.attributions.compactMap { item in
                    guard let task = store.plan.projects.flatMap(\.tasks).first(where: { $0.id == item.taskId }), let project = store.project(for: task) else { return nil }
                    return WorkSelection(task: task, project: project, completed: item.completed)
                }
            } else { selections = record.local?.selections ?? [] }
        }
        .confirmationDialog("Delete this session? Tasks in Plan are unchanged.", isPresented: $confirmDelete) {
            Button("Delete session", role: .destructive) {
                Task {
                    if let remote = record.remote { await store.deleteRemote(remote) }
                    else if let local = record.local { store.change { $0.sessions.removeAll { $0.id == local.id } } }
                    dismiss()
                }
            }
        }
    }
    private func save() {
        saving = true
        Task {
            if let remote = record.remote {
                var attributions: [[String: Any]] = selections.map { selection in
                    if let item = savedAttributions.first(where: { $0.taskId == selection.taskId }) { return ["attribution_id": item.id, "completed": selection.completed] }
                    return ["task_id": selection.taskId, "completed": selection.completed]
                }
                let taskIds = Set(store.plan.projects.flatMap(\.tasks).map(\.id))
                attributions += savedAttributions.filter { $0.taskId == nil || !taskIds.contains($0.taskId!) }.map { ["attribution_id": $0.id, "completed": $0.completed] }
                if await store.editRemote(remote, note: note, attributions: attributions) { dismiss() }
            } else if let local = record.local {
                if store.change({ state in
                    if let i = state.sessions.firstIndex(where: { $0.id == local.id }) { state.sessions[i].note = note; state.sessions[i].selections = selections }
                }) { dismiss() }
            }
            saving = false
        }
    }
}
