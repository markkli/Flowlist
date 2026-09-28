import SwiftUI
#if SWIFT_PACKAGE
import FlowlistCore
#endif

struct PlanEditor: Identifiable {
    let id = UUID()
    var project: PlanProject?
    var task: PlanTask?
    var destination: Int?
    var parent: Int?
    var newProject = false
}
struct PlanView: View {
    @EnvironmentObject var store: TimerStore
    @State private var editor: PlanEditor?
    @State private var showCompleted = false
    @State private var collapsed: Set<Int> = []
    @State private var removal: PlanEditor?
    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            HStack {
                Toggle("Show completed", isOn: $showCompleted).toggleStyle(.checkbox).font(.callout)
                Spacer()
                Button { editor = PlanEditor(newProject: true) } label: { Label("Project", systemImage: "folder.badge.plus") }
                Button { editor = PlanEditor() } label: { Label("Task", systemImage: "plus") }
            }
            if store.plan.projects.isEmpty {
                ContentUnavailableView("Make room for your next idea", systemImage: "checklist", description: Text("Create a project for a bigger goal, or a task for a quick to-do."))
            }
            ForEach(store.plan.projects.filter { showCompleted || !$0.completed }) { project in
                VStack(alignment: .leading, spacing: 0) {
                    HStack {
                        Image(systemName: project.goalType == "standalone" ? "checklist" : "folder").foregroundStyle(store.theme.tint)
                        Text(project.title).font(.system(size: 19, weight: .semibold))
                        Spacer()
                        Text("\(project.tasks.filter(\.completed).count)/\(project.tasks.count)").font(.caption).foregroundStyle(.secondary)
                        Button { editor = PlanEditor(destination: project.id) } label: { Image(systemName: "plus").frame(width: 28, height: 28) }
                            .buttonStyle(.plain).help("Add task").accessibilityLabel("Add task to \(project.title)")
                        Menu {
                            Button("Rename") { editor = PlanEditor(project: project) }
                            if project.goalType != "standalone" {
                                Button(project.completed ? "Reopen project" : "Close project") { Task { await store.closeProject(project, completed: !project.completed) } }
                                    .disabled(!project.completed && (project.tasks.isEmpty || project.tasks.contains { !$0.completed }))
                            }
                            Button("Delete project…", role: .destructive) { removal = PlanEditor(project: project) }
                        } label: { Image(systemName: "ellipsis") }.menuStyle(.borderlessButton).fixedSize().accessibilityLabel("Project options")
                    }.padding(20)
                    if project.tasks.isEmpty { Text("Add your first task.").font(.callout).foregroundStyle(.secondary).padding([.horizontal, .bottom], 20) }
                    ForEach(project.roots.filter { showCompleted || !$0.completed }) { task in
                        VStack(spacing: 0) {
                            Divider()
                            row(task, project: project, child: false)
                            if !collapsed.contains(task.id) {
                                ForEach(project.children(of: task).filter { showCompleted || !$0.completed }) { child in
                                    HStack(spacing: 0) {
                                        Rectangle().fill(store.theme.tint.opacity(0.35)).frame(width: 2).padding(.leading, 31).padding(.trailing, 13)
                                        row(child, project: project, child: true)
                                    }.background(store.theme.tint.opacity(0.035))
                                }
                            }
                        }
                    }
                }.background(.background, in: RoundedRectangle(cornerRadius: 16))
                    .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(.secondary.opacity(0.15)))
            }
        }.disabled(store.busy || store.connecting || store.storageUnavailable)
        .sheet(item: $editor) { TaskEditor(editor: $0).environmentObject(store) }
        .confirmationDialog("Delete this item and its subtasks? Saved history is kept.", isPresented: Binding(get: { removal != nil }, set: { if !$0 { removal = nil } })) {
            Button("Delete", role: .destructive) {
                let selected = removal; removal = nil
                Task { if let task = selected?.task { await store.deleteTask(task) } else if let project = selected?.project { await store.deleteProject(project) } }
            }
        }
    }
    private func row(_ task: PlanTask, project: PlanProject, child: Bool) -> some View {
        HStack(spacing: 12) {
            if !child {
                Button { if collapsed.contains(task.id) { collapsed.remove(task.id) } else { collapsed.insert(task.id) } } label: {
                    Image(systemName: collapsed.contains(task.id) ? "chevron.right" : "chevron.down").font(.caption).frame(width: 16, height: 28)
                }.buttonStyle(.plain).opacity(project.children(of: task).isEmpty ? 0 : 1).disabled(project.children(of: task).isEmpty)
                    .accessibilityLabel("Toggle subtasks for \(task.title)")
            }
            Toggle(isOn: Binding(get: { task.completed }, set: { value in Task { await store.setCompleted(task, value: value) } })) { EmptyView() }
                .toggleStyle(.checkbox).labelsHidden().accessibilityLabel("Complete \(task.title)")
            Text(task.title).strikethrough(task.completed).foregroundStyle(task.completed ? .secondary : .primary).frame(maxWidth: .infinity, alignment: .leading)
            if !task.completed {
                Button { Task { await store.prioritize(task) } } label: {
                    Image(systemName: store.plan.priorityIds.contains(task.id) ? "star.fill" : "star").foregroundStyle(store.theme.tint).frame(width: 28, height: 30)
                }.buttonStyle(.plain).help("Priority").accessibilityLabel("\(store.plan.priorityIds.contains(task.id) ? "Remove priority from" : "Prioritize") \(task.title)")
            }
            Menu {
                Button("Rename") { editor = PlanEditor(task: task) }
                if task.parentId == nil && project.goalType != "standalone" && !task.completed {
                    Button("Add subtask") { editor = PlanEditor(destination: project.id, parent: task.id) }
                }
                Button("Delete…", role: .destructive) { removal = PlanEditor(task: task) }
            } label: { Image(systemName: "ellipsis") }.menuStyle(.borderlessButton).fixedSize().accessibilityLabel("Options for \(task.title)")
        }.padding(.horizontal, child ? 12 : 16).padding(.vertical, 10)
    }
}

struct TaskEditor: View {
    @EnvironmentObject var store: TimerStore
    @Environment(\.dismiss) private var dismiss
    let editor: PlanEditor
    @State private var title = ""
    @State private var projectId: Int?
    @State private var parentId: Int?
    @State private var createProject = false
    @State private var saving = false
    @FocusState private var titleFocused: Bool
    private var renaming: Bool { editor.task != nil || editor.project != nil }
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text(renaming ? "Rename" : createProject ? "New project" : "New task").font(.title2.weight(.semibold))
            if !renaming {
                Picker("Create", selection: $createProject) { Text("Task").tag(false); Text("Project").tag(true) }.pickerStyle(.segmented)
            }
            VStack(alignment: .leading, spacing: 8) {
                Text("Name").font(.headline)
                TextField(createProject ? "What are you working toward?" : "What needs doing?", text: $title).textFieldStyle(.roundedBorder).focused($titleFocused).onSubmit { submit() }
            }
            if !renaming && !createProject {
                Text("Add to").font(.headline)
                ScrollView {
                    VStack(alignment: .leading, spacing: 4) {
                        destination("Standalone task", symbol: "checklist", project: nil, parent: nil)
                        ForEach(store.plan.projects.filter { !$0.completed && $0.goalType != "standalone" }) { project in
                            DisclosureGroup {
                                ForEach(project.roots.filter { !$0.completed }) { task in
                                    destination(task.title, symbol: "arrow.turn.down.right", project: project.id, parent: task.id).padding(.leading, 12)
                                }
                            } label: { destination(project.title, symbol: "folder", project: project.id, parent: nil) }
                        }
                    }.padding(6)
                }.frame(maxHeight: 240).background(.quaternary.opacity(0.25), in: RoundedRectangle(cornerRadius: 10))
            }
            if let error = store.error { Text(error).font(.caption).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true) }
            HStack {
                Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
                Spacer()
                if saving { ProgressView().controlSize(.small) }
                Button(renaming ? "Save" : createProject ? "Create project" : "Add task", action: submit).keyboardShortcut(.defaultAction)
                    .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || title.count > 120 || saving || store.busy)
            }
        }.padding(28).frame(width: 470).background(Color(nsColor: .windowBackgroundColor)).tint(store.theme.tint).disabled(saving)
        .onAppear {
            title = editor.task?.title ?? editor.project?.title ?? ""
            projectId = editor.destination; parentId = editor.parent; createProject = editor.newProject
            titleFocused = true
        }
    }
    private func destination(_ title: String, symbol: String, project: Int?, parent: Int?) -> some View {
        Button { projectId = project; parentId = parent } label: {
            HStack(spacing: 8) {
                Image(systemName: symbol).foregroundStyle(.secondary)
                Text(title).multilineTextAlignment(.leading)
                Spacer()
                if projectId == project && parentId == parent { Image(systemName: "checkmark").foregroundStyle(store.theme.tint) }
            }.padding(9).contentShape(Rectangle())
                .background(projectId == project && parentId == parent ? store.theme.tint.opacity(0.12) : .clear, in: RoundedRectangle(cornerRadius: 7))
        }.buttonStyle(.plain).accessibilityAddTraits(projectId == project && parentId == parent ? .isSelected : [])
    }
    private func submit() {
        let name = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, name.count <= 120, !saving, !store.busy else { return }
        saving = true
        Task {
            let success: Bool
            if let task = editor.task { success = await store.renameTask(task, title: name) }
            else if let project = editor.project { success = await store.renameProject(project, title: name) }
            else if createProject { success = await store.createProject(title: name) }
            else { success = await store.createTask(title: name, projectId: projectId, parentId: parentId) }
            saving = false
            if success { dismiss() }
        }
    }
}

struct NoteField: View {
    @Binding var note: String
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack { Text("Note").font(.headline); Spacer(); Text("Optional").font(.caption).foregroundStyle(.secondary) }
            TextEditor(text: $note).font(.body).scrollContentBackground(.hidden).padding(8).frame(height: 90)
                .background(.quaternary.opacity(0.25), in: RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(.secondary.opacity(0.2)))
                .accessibilityLabel("Session note")
            if note.count > 2000 { Text("Keep your note under 2,000 characters.").font(.caption).foregroundStyle(.red) }
        }
    }
}

struct WorkChecklist: View {
    let projects: [PlanProject]
    let selections: [WorkSelection]
    var unfinishedOnly = false
    var inheritCompletion = true
    let action: (PlanTask, Bool, Bool) -> Void
    private var visible: [PlanProject] { projects.filter { !unfinishedOnly || (!$0.completed && $0.tasks.contains { !$0.completed }) } }
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            if visible.isEmpty { Text("No tasks selected. This session will be General focus.").font(.callout).foregroundStyle(.secondary) }
            ForEach(visible) { project in
                VStack(alignment: .leading, spacing: 10) {
                    Text(project.title).font(.headline)
                    VStack(spacing: 0) {
                        ForEach(project.roots.filter { !unfinishedOnly || !$0.completed }) { root in
                            VStack(spacing: 0) {
                                workRow(root)
                                let children = project.children(of: root).filter { !unfinishedOnly || !$0.completed }
                                if !children.isEmpty {
                                    VStack(spacing: 0) { ForEach(children) { child in workRow(child) } }
                                        .padding(.leading, 40).background(.quaternary.opacity(0.15))
                                        .overlay(alignment: .leading) { Rectangle().fill(.secondary.opacity(0.3)).frame(width: 2).padding(.leading, 28) }
                                }
                            }
                            Divider()
                        }
                    }.background(.quaternary.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
                }
            }
        }
    }
    private func workRow(_ task: PlanTask) -> some View {
        let selection = selections.first { $0.taskId == task.id }
        let inherited = inheritCompletion && task.parentId.flatMap { parent in selections.first { $0.taskId == parent && $0.completed } } != nil
        return HStack(spacing: 18) {
            Text(task.title).frame(maxWidth: .infinity, alignment: .leading).fixedSize(horizontal: false, vertical: true)
            Toggle("Worked on", isOn: Binding(get: { selection != nil || inherited }, set: { action(task, false, $0) }))
                .toggleStyle(.checkbox).frame(width: 100, alignment: .leading).disabled(inherited)
            Toggle("Finished", isOn: Binding(get: { selection?.completed == true || inherited }, set: { action(task, true, $0) }))
                .toggleStyle(.checkbox).frame(width: 86, alignment: .leading).disabled(inherited)
        }.font(.callout).padding(14)
    }
}
