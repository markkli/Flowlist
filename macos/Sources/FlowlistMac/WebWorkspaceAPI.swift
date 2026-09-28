import Foundation
import CoreFoundation
#if SWIFT_PACKAGE
import FlowlistCore
#endif

/// The bundled web workspace talks to this allowlisted adapter, never to a
/// user-supplied URL. Credentials remain in CloudClient and Keychain.
@MainActor final class WebWorkspaceAPI {
    let store: TimerStore
    init(store: TimerStore) { self.store = store }

    func request(path: String, method: String = "GET", body: [String: Any]? = nil) async throws -> Any {
        let method = method.uppercased()
        let route = try Route(path: path, method: method)
        if route.parts == ["account", "onboarding"] {
            guard let version = body?["version"] as? Int, version >= 1, version <= 10000 else { throw failure("Choose a valid Guide version.", 422) }
            guard store.change({ $0.webOnboardingVersion = version }) else { throw storageFailure() }
            return ["version": version]
        }
        guard let owner = store.account?.id else { return try local(route, body ?? [:]) }
        do {
            let payload = try body.map { try JSONSerialization.data(withJSONObject: $0) }
            let response = try await store.cloud.requestJSON(path, method: method, body: payload, owner: owner)
            guard store.account?.id == owner else { throw failure("The account changed. Refresh the workspace.", 409) }
            if method == "GET" {
                cache(response, path: path)
                updateNativeCache(response, route: route)
            } else {
                store.change { $0.webResponseCache = nil }
                if ["goals", "tasks", "standalone-tasks", "queue", "guide"].contains(route.parts.first ?? "") {
                    await refreshNativePlan(owner: owner)
                } else if route.parts.first == "sessions" {
                    updateHistoryCache(response, route: route)
                }
            }
            return response
        } catch let error as CloudFailure where error.isTransport && method == "GET" && store.account?.id == owner {
            // A 401/403/404, validation failure, malformed response, or account
            // switch must never be disguised as a successful offline read.
            if let data = store.workspace.webResponseCache?[path] {
                store.syncError = "Offline — showing the last synced workspace."
                return try JSONSerialization.jsonObject(with: data)
            }
            throw error
        }
    }

    private struct Route {
        let method: String
        let parts: [String]
        let query: [String: String]
        init(path: String, method: String) throws {
            guard path.hasPrefix("/"), !path.hasPrefix("//"), !path.contains("\\"),
                  let components = URLComponents(string: path), components.scheme == nil,
                  components.host == nil, components.fragment == nil,
                  !components.percentEncodedPath.contains("%"), !components.path.contains(".."),
                  !components.path.contains("//") else { throw CloudFailure(message: "Unsupported workspace request.", status: 400) }
            self.method = method
            parts = components.path.split(separator: "/").map(String.init)
            var values: [String: String] = [:]
            for item in components.queryItems ?? [] {
                guard values[item.name] == nil else { throw CloudFailure(message: "Duplicate query parameter.", status: 400) }
                values[item.name] = item.value ?? ""
            }
            query = values
            let numbered = parts.map { Int($0) != nil ? ":id" : $0 }.joined(separator: "/")
            let routes: [String: Set<String>] = [
                "account": ["GET", "DELETE"], "account/onboarding": ["PATCH"],
                "dashboard": ["GET"], "stats": ["GET"], "focus-options": ["GET"], "next-focus": ["GET"],
                "goals": ["GET", "POST"], "goals/reorder": ["POST"], "goals/with-task": ["POST"],
                "goals/:id": ["GET", "PATCH", "DELETE"], "goals/:id/tasks": ["GET", "POST"],
                "standalone-tasks": ["POST"], "tasks/reorder": ["POST"],
                "tasks/:id": ["PATCH", "DELETE"], "tasks/:id/subtasks": ["POST"],
                "queue": ["GET", "PUT"], "queue/:id": ["POST", "DELETE"],
                "guide/example": ["POST"], "guide/example/:id": ["DELETE"],
                "history/week": ["GET"], "history/task-options": ["GET"],
                "sessions": ["GET"], "sessions/:id": ["GET", "PATCH", "DELETE"], "sessions/:id/restore": ["POST"],
                "export": ["GET"]
            ]
            guard routes[numbered]?.contains(method) == true else { throw CloudFailure(message: "Unsupported workspace request.", status: 404) }
            let allowedQueries: Set<String>
            switch numbered {
            case "goals": allowedQueries = ["include_tasks"]
            case "dashboard", "stats": allowedQueries = ["timezone"]
            case "history/week": allowedQueries = ["start", "timezone"]
            case "sessions": allowedQueries = ["limit", "before_id", "deleted"]
            default: allowedQueries = []
            }
            guard Set(query.keys).isSubset(of: allowedQueries) else { throw CloudFailure(message: "Unsupported query parameter.", status: 400) }
        }
    }

    private func cache(_ value: Any, path: String) {
        guard JSONSerialization.isValidJSONObject(value), let data = try? JSONSerialization.data(withJSONObject: value), data.count <= 4_000_000 else { return }
        store.change { state in
            var entries = state.webResponseCache ?? [:]
            // Calendar navigation cannot grow the persisted cache indefinitely.
            if entries.count >= 96 && entries[path] == nil { entries = [:] }
            entries[path] = data
            state.webResponseCache = entries
        }
    }
    private func updateNativeCache(_ value: Any, route: Route) {
        guard let data = try? JSONSerialization.data(withJSONObject: value) else { return }
        if route.parts == ["goals"], route.query["include_tasks"] == "true", let projects = try? CloudJSON.decoder().decode([PlanProject].self, from: data) {
            store.change { state in var plan = state.plan ?? PlanCache(); plan.projects = projects; plan.refreshedAt = Date(); state.plan = plan }
        } else if route.parts == ["focus-options"], let options = value as? [[String: Any]] {
            // The user can create tasks in the website while the Mac is open.
            // Reconcile these fresh choices before the native review validates
            // their IDs; a stale background Plan cache must not reject them.
            store.change { state in
                var plan = state.plan ?? PlanCache()
                for option in options {
                    guard let id = option["id"] as? Int, let goalID = option["goal_id"] as? Int,
                          let title = option["title"] as? String, let goalTitle = option["goal_title"] as? String else { continue }
                    let gi: Int
                    if let index = plan.projects.firstIndex(where: { $0.id == goalID }) { gi = index }
                    else {
                        plan.projects.append(PlanProject(id: goalID, title: goalTitle, goalType: option["goal_type"] as? String ?? "project", position: plan.projects.count))
                        gi = plan.projects.count - 1
                    }
                    plan.projects[gi].title = goalTitle; plan.projects[gi].completed = false
                    let task = PlanTask(id: id, goalId: goalID, parentId: option["parent_id"] as? Int, title: title, position: option["position"] as? Int ?? 0)
                    if let ti = plan.projects[gi].tasks.firstIndex(where: { $0.id == id }) { plan.projects[gi].tasks[ti] = task }
                    else { plan.projects[gi].tasks.append(task) }
                }
                state.plan = plan
            }
        } else if route.parts == ["dashboard"], let dashboard = value as? [String: Any], let rows = dashboard["goals"] as? [[String: Any]] {
            let active: [PlanProject] = rows.compactMap { row in
                guard var goal = row["goal"] as? [String: Any] else { return nil }
                goal["tasks"] = row["tasks"] ?? []
                guard let data = try? JSONSerialization.data(withJSONObject: goal) else { return nil }
                return try? CloudJSON.decoder().decode(PlanProject.self, from: data)
            }
            store.change { state in
                var plan = state.plan ?? PlanCache()
                let activeIDs = Set(active.map(\.id))
                plan.projects = active + plan.projects.filter { $0.completed && !activeIDs.contains($0.id) }
                if let queue = dashboard["queue"] as? [[String: Any]] { plan.priorityIds = queue.compactMap { ($0["task"] as? [String: Any])?["id"] as? Int } }
                plan.refreshedAt = Date(); state.plan = plan
            }
        } else if route.parts == ["queue"], let queue = value as? [[String: Any]] {
            let ids = queue.compactMap { ($0["task"] as? [String: Any])?["id"] as? Int }
            store.change { state in var plan = state.plan ?? PlanCache(); plan.priorityIds = ids; state.plan = plan }
        } else if route.parts == ["sessions"], route.query["deleted"] != "true", let sessions = try? CloudJSON.decoder().decode([RemoteSession].self, from: data) {
            store.change { state in
                let incoming = Set(sessions.map(\.id))
                state.cloudHistory = sessions + (state.cloudHistory ?? []).filter { !incoming.contains($0.id) }
            }
        }
    }
    private func refreshNativePlan(owner: String) async {
        do {
            let projects = try await store.cloud.requestJSON("/goals?include_tasks=true", owner: owner)
            let queue = try await store.cloud.requestJSON("/queue", owner: owner)
            guard store.account?.id == owner else { return }
            updateNativeCache(projects, route: try Route(path: "/goals?include_tasks=true", method: "GET"))
            updateNativeCache(queue, route: try Route(path: "/queue", method: "GET"))
            cache(projects, path: "/goals?include_tasks=true"); cache(queue, path: "/queue")
        } catch { if store.account?.id == owner { store.syncError = "Your change was saved. Reconnect to refresh the Mac’s cached Plan." } }
    }
    private func updateHistoryCache(_ value: Any, route: Route) {
        if route.method == "DELETE", let id = route.parts.dropFirst().first.flatMap(Int.init) { store.change { $0.cloudHistory?.removeAll { $0.id == id } }; return }
        guard let data = try? JSONSerialization.data(withJSONObject: value), let session = try? CloudJSON.decoder().decode(RemoteSession.self, from: data) else { return }
        store.change { $0.cloudHistory = [session] + ($0.cloudHistory ?? []).filter { $0.id != session.id } }
    }

    private func local(_ route: Route, _ body: [String: Any]) throws -> Any {
        var workspace = store.workspace
        var plan = workspace.planForEditing
        let parts = route.parts, method = route.method
        let id = parts.count > 1 ? Int(parts[1]) : nil
        if parts == ["account"] {
            guard method == "GET" else { throw failure("Local work has no online account to delete.", 400) }
            return ["id": NSNull(), "email": NSNull(), "mode": "local", "onboarding_version": workspace.webOnboardingVersion as Any? ?? NSNull()]
        }
        if parts == ["goals"], method == "GET" { return sortedProjects(plan).map { goalJSON($0, tasks: route.query["include_tasks"] == "true") } }
        if parts == ["queue"], method == "GET" { return queueJSON(plan) }
        if parts == ["focus-options"] { return focusOptions(plan, workspace: workspace) }
        if parts == ["history", "task-options"] {
            return orderedTasks(plan).map { task, goal -> [String: Any] in var row = taskJSON(task); row["goal_title"] = goal.title; row["goal_type"] = goal.goalType; return row }
        }
        if parts == ["next-focus"] {
            let parents = Set(plan.projects.flatMap(\.tasks).compactMap(\.parentId))
            guard let (task, goal) = orderedTasks(plan).first(where: { !$0.0.completed && !$0.1.completed && !parents.contains($0.0.id) }) else { throw failure("No unfinished focus task found.", 404) }
            return ["task": taskJSON(task), "goal": goalJSON(goal)]
        }
        if ["sessions", "history", "dashboard", "stats", "export"].contains(parts.first ?? "") {
            try assignHistoryIDs(&workspace)
            let result = try history(route, body, workspace: &workspace, plan: plan)
            if workspace != store.workspace { try commit(workspace) }
            return result
        }
        if parts == ["guide", "example"], method == "POST" {
            if let existing = plan.projects.first(where: { $0.isExample == true }) { return goalJSON(existing, tasks: true) }
            var goal = PlanProject(id: plan.nextLocalId, title: "Learn Flowlist", position: plan.projects.count)
            goal.isExample = true
            plan.projects.append(goal)
            let index = plan.projects.count - 1
            for (title, child) in [("Understand Pomodoro", "Customize the timer"), ("Organize your work", "Star a priority"), ("Review a focus session", nil)] as [(String, String?)] {
                let task = addTask(title, index: index, parent: nil, plan: &plan)
                if let child { _ = addTask(child, index: index, parent: task.id, plan: &plan) }
            }
            workspace.plan = plan; try commit(workspace)
            return goalJSON(plan.projects[index], tasks: true)
        }
        if parts.count == 3, parts[0] == "guide", parts[1] == "example", let exampleID = Int(parts[2]) {
            guard let index = plan.projects.firstIndex(where: { $0.id == exampleID }) else { throw failure("Project not found.", 404) }
            guard plan.projects[index].isExample == true else { throw failure("This is not a Guide example.", 409) }
            removeProject(index, plan: &plan); workspace.plan = plan; try commit(workspace); return ["deleted": true]
        }
        if (parts == ["goals"] && method == "POST") || parts == ["goals", "with-task"] {
            let kind = body["goal_type"] as? String ?? "project"
            guard ["project", "learning", "standalone"].contains(kind), parts.count == 1 || kind == "project" else { throw failure("Choose a project for this action.", 422) }
            var project = PlanProject(id: plan.nextLocalId, title: try title(body), goalType: kind == "learning" ? "project" : kind, position: plan.projects.count)
            project.description = body["description"] as? String
            plan.projects.append(project)
            if parts.count == 2 {
                guard let task = body["task"] as? [String: Any] else { throw failure("Enter a task name.", 422) }
                _ = addTask(try title(task), index: plan.projects.count - 1, parent: nil, plan: &plan)
            }
            workspace.plan = plan; try commit(workspace); return goalJSON(plan.projects.last!, tasks: parts.count == 2)
        }
        if parts == ["goals", "reorder"] {
            let ids = try orderedIDs(body)
            guard Set(ids) == Set(plan.projects.map(\.id)) else { throw failure("Reorder every project exactly once.", 400) }
            for index in plan.projects.indices { plan.projects[index].position = ids.firstIndex(of: plan.projects[index].id)! }
            workspace.plan = plan; try commit(workspace); return sortedProjects(plan).map { goalJSON($0) }
        }
        if parts.first == "goals", let id {
            guard let index = plan.projects.firstIndex(where: { $0.id == id }) else { throw failure("Project not found.", 404) }
            if parts.count == 3, parts[2] == "tasks" {
                if method == "GET" { return plan.projects[index].tasks.sorted(by: taskOrder).map(taskJSON) }
                let task = addTask(try title(body), index: index, parent: nil, plan: &plan)
                workspace.plan = plan; try commit(workspace); return taskJSON(task)
            }
            if method == "GET" { return goalJSON(plan.projects[index]) }
            if method == "DELETE" { removeProject(index, plan: &plan); workspace.plan = plan; try commit(workspace); return ["deleted": true] }
            if body.keys.contains("title") { plan.projects[index].title = try title(body) }
            if body.keys.contains("description") { plan.projects[index].description = body["description"] as? String }
            if let kind = body["goal_type"] as? String {
                guard ["project", "learning", "standalone"].contains(kind), (kind == "standalone") == (plan.projects[index].goalType == "standalone") else { throw failure("The shared Tasks list cannot change type.", 400) }
                plan.projects[index].goalType = kind == "learning" ? "project" : kind
            }
            if body.keys.contains("completed") {
                let completed = try boolean(body, "completed")
                if completed {
                    guard plan.projects[index].goalType != "standalone" else { throw failure("The shared Tasks list stays active.", 400) }
                    guard !plan.projects[index].roots.isEmpty, plan.projects[index].roots.allSatisfy(\.completed) else { throw failure("Complete every top-level task before closing this project.", 409) }
                }
                plan.projects[index].completed = completed
            }
            workspace.plan = plan; try commit(workspace); return goalJSON(plan.projects[index])
        }
        if parts == ["standalone-tasks"] {
            let name = try title(body)
            let index: Int
            if let existing = plan.projects.firstIndex(where: { $0.goalType == "standalone" }) { index = existing }
            else { plan.projects.append(PlanProject(id: plan.nextLocalId, title: "Tasks", goalType: "standalone", position: plan.projects.count)); index = plan.projects.count - 1 }
            let task = addTask(name, index: index, parent: nil, plan: &plan)
            workspace.plan = plan; try commit(workspace); return taskJSON(task)
        }
        if parts == ["tasks", "reorder"] {
            let ids = try orderedIDs(body)
            guard let first = ids.first, let (gi, ti) = taskIndex(first, plan) else { throw failure("Task not found.", 404) }
            let parent = plan.projects[gi].tasks[ti].parentId
            let siblings = plan.projects[gi].tasks.filter { $0.parentId == parent }
            guard Set(ids) == Set(siblings.map(\.id)) else { throw failure("Reorder every task in this section exactly once.", 400) }
            for index in plan.projects[gi].tasks.indices {
                if let position = ids.firstIndex(of: plan.projects[gi].tasks[index].id) { plan.projects[gi].tasks[index].position = position }
            }
            workspace.plan = plan; try commit(workspace)
            return ids.compactMap { id in plan.projects[gi].tasks.first { $0.id == id } }.map(taskJSON)
        }
        if parts.first == "tasks", let id {
            guard let (gi, ti) = taskIndex(id, plan) else { throw failure("Task not found.", 404) }
            if parts.count == 3 {
                guard plan.projects[gi].goalType != "standalone" else { throw failure("The Tasks list does not support nested steps.", 400) }
                guard plan.projects[gi].tasks[ti].parentId == nil, plan.projects[gi].tasks[ti].depth < 2 else { throw failure("Subtasks cannot contain another level. Add a sibling subtask instead.", 400) }
                let task = addTask(try title(body), index: gi, parent: id, plan: &plan)
                workspace.plan = plan; try commit(workspace); return taskJSON(task)
            }
            if method == "DELETE" { plan.deleteTask(id); workspace.plan = plan; try commit(workspace); return ["deleted": true] }
            if body.keys.contains("title") { plan.projects[gi].tasks[ti].title = try title(body) }
            if body.keys.contains("completed") { plan.setCompleted(id, completed: try boolean(body, "completed")) }
            workspace.plan = plan; try commit(workspace); return taskJSON(plan.projects[gi].tasks[ti])
        }
        if parts.first == "queue" {
            if method == "DELETE", let id { plan.priorityIds.removeAll { $0 == id } }
            else {
                let ids = method == "PUT" ? try orderedIDs(body, emptyAllowed: true) : [id!]
                for id in ids {
                    guard let (gi, ti) = taskIndex(id, plan) else { throw failure("A selected task no longer exists.", 404) }
                    guard !plan.projects[gi].completed, !plan.projects[gi].tasks[ti].completed else { throw failure("Choose unfinished tasks from active projects.", 409) }
                }
                if method == "PUT" { plan.priorityIds = ids }
                else if let id, !plan.priorityIds.contains(id) { plan.priorityIds.append(id) }
            }
            workspace.plan = plan; try commit(workspace); return queueJSON(plan)
        }
        throw failure("Unsupported workspace request.", 404)
    }

    private func addTask(_ title: String, index: Int, parent: Int?, plan: inout PlanCache) -> PlanTask {
        let siblings = plan.projects[index].tasks.filter { $0.parentId == parent }
        let position = (siblings.map(\.position).max() ?? -1) + 1
        let task = PlanTask(id: plan.nextLocalId, goalId: plan.projects[index].id, parentId: parent, title: title, position: position)
        plan.projects[index].tasks.append(task); plan.projects[index].completed = false
        if let parent, let i = plan.projects[index].tasks.firstIndex(where: { $0.id == parent }) { plan.projects[index].tasks[i].completed = false }
        return task
    }
    private func removeProject(_ index: Int, plan: inout PlanCache) {
        let ids = Set(plan.projects[index].tasks.map(\.id))
        plan.projects.remove(at: index); plan.priorityIds.removeAll { ids.contains($0) }
    }
    private func taskIndex(_ id: Int, _ plan: PlanCache) -> (Int, Int)? {
        for gi in plan.projects.indices { if let ti = plan.projects[gi].tasks.firstIndex(where: { $0.id == id }) { return (gi, ti) } }
        return nil
    }
    private func taskOrder(_ a: PlanTask, _ b: PlanTask) -> Bool { a.position == b.position ? a.id > b.id : a.position < b.position }
    private func sortedProjects(_ plan: PlanCache) -> [PlanProject] { plan.projects.sorted { $0.position == $1.position ? $0.id > $1.id : $0.position < $1.position } }
    private func orderedTasks(_ plan: PlanCache) -> [(PlanTask, PlanProject)] {
        sortedProjects(plan).flatMap { goal in goal.roots.flatMap { root in ([root] + goal.children(of: root)).map { ($0, goal) } } }
    }
    private func taskJSON(_ task: PlanTask) -> [String: Any] {
        ["id": task.id, "goal_id": task.goalId, "parent_id": task.parentId as Any? ?? NSNull(), "depth": task.depth, "title": task.title, "completed": task.completed, "position": task.position]
    }
    private func goalJSON(_ goal: PlanProject, tasks: Bool = false) -> [String: Any] {
        var row: [String: Any] = ["id": goal.id, "title": goal.title, "description": goal.description as Any? ?? NSNull(), "goal_type": goal.goalType, "completed": goal.completed, "position": goal.position, "is_example": goal.isExample == true]
        if tasks { row["tasks"] = goal.tasks.sorted(by: taskOrder).map(taskJSON) }
        return row
    }
    private func queueJSON(_ plan: PlanCache) -> [[String: Any]] {
        plan.priorityIds.compactMap { id in
            guard let (gi, ti) = taskIndex(id, plan), !plan.projects[gi].completed, !plan.projects[gi].tasks[ti].completed else { return nil }
            return ["task": taskJSON(plan.projects[gi].tasks[ti]), "goal": goalJSON(plan.projects[gi])]
        }
    }
    private func focusOptions(_ plan: PlanCache, workspace: LocalWorkspace) -> [[String: Any]] {
        orderedTasks(plan).filter { !$0.0.completed && !$0.1.completed }.map { task, goal in
            var row = taskJSON(task)
            row["goal_title"] = goal.title; row["goal_type"] = goal.goalType
            row["has_children"] = goal.tasks.contains { $0.parentId == task.id }
            row["ancestor_titles"] = task.parentId.flatMap { id in goal.tasks.first { $0.id == id }.map { [$0.title] } } ?? []
            let recent = workspace.sessions.filter { (workspace.webHistoryMetadata?[$0.id.uuidString]?.deletedAt == nil) && ($0.selections ?? []).contains { $0.taskId == task.id } }.map(\.endedAt).max()
            row["last_focused_at"] = recent.map(iso) as Any? ?? NSNull()
            return row
        }
    }
    private func commit(_ workspace: LocalWorkspace) throws { guard store.change({ $0 = workspace }) else { throw storageFailure() } }
    private func failure(_ message: String, _ status: Int = 400) -> CloudFailure { CloudFailure(message: message, status: status) }
    private func storageFailure() -> CloudFailure { failure(store.error ?? "Couldn’t save on this Mac. Try again.", 507) }
    private func title(_ body: [String: Any]) throws -> String {
        guard let input = body["title"] as? String else { throw failure("Enter a name.", 422) }
        let value = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, value.count <= 120 else { throw failure("Use a name between 1 and 120 characters.", 422) }
        return value
    }
    private func boolean(_ body: [String: Any], _ key: String) throws -> Bool {
        guard let value = body[key] as? NSNumber, CFGetTypeID(value) == CFBooleanGetTypeID() else { throw failure("Choose a valid \(key) value.", 422) }
        return value.boolValue
    }
    private func orderedIDs(_ body: [String: Any], emptyAllowed: Bool = false) throws -> [Int] {
        guard let ids = body["ordered_ids"] as? [Int], (emptyAllowed || !ids.isEmpty), Set(ids).count == ids.count else { throw failure("Choose each task or project once.", 422) }
        return ids
    }
    private func iso(_ date: Date) -> String { ISO8601DateFormatter().string(from: date) }
}

private extension WebWorkspaceAPI {
    func assignHistoryIDs(_ workspace: inout LocalWorkspace) throws {
        var metadata = workspace.webHistoryMetadata ?? [:]
        // Oldest first makes numeric cursors match the backend’s newest-first API.
        for session in workspace.sessions.sorted(by: { $0.endedAt < $1.endedAt }) {
            let key = session.id.uuidString
            var entry = metadata[key] ?? WebHistoryMetadata(id: (metadata.values.map(\.id).max() ?? 0) + 1)
            for selection in session.selections ?? [] where entry.attributionIDs[String(selection.taskId)] == nil {
                entry.attributionIDs[String(selection.taskId)] = (entry.attributionIDs.values.max() ?? 0) + 1
            }
            metadata[key] = entry
        }
        workspace.webHistoryMetadata = metadata
    }
    func sessionJSON(_ session: LocalSession, workspace: LocalWorkspace, plan: PlanCache) -> [String: Any] {
        let metadata = workspace.webHistoryMetadata?[session.id.uuidString] ?? WebHistoryMetadata(id: 0)
        let selections = session.selections ?? []
        let blocks = normalizedBlocks(session)
        let seconds = blocks.reduce(0) { $0 + Int($1.1.timeIntervalSince($1.0)) }
        let title: String
        if !session.note.isEmpty { title = String(session.note.split(whereSeparator: \.isNewline).first ?? "").prefix(120).description }
        else if selections.count == 1 { title = selections[0].title }
        else if !selections.isEmpty && Set(selections.map(\.goalTitle)).count == 1 { title = selections[0].goalTitle + " focus" }
        else { title = selections.isEmpty ? "General focus" : "Focused work" }
        let attributions: [[String: Any]] = selections.map { selection in
            ["id": metadata.attributionIDs[String(selection.taskId)] ?? 0,
             "task_id": taskIndex(selection.taskId, plan) != nil ? selection.taskId as Any : NSNull(),
             "task_title": selection.title, "goal_title": selection.goalTitle, "completed": selection.completed]
        }
        return ["id": metadata.id, "task_title": title, "summary": session.note.isEmpty ? NSNull() : session.note as Any,
                "planned_minutes": SessionUpload(session: session).plannedMinutes, "actual_minutes": seconds / 60,
                "completed": true, "created_at": iso(session.endedAt), "started_at": iso(session.startedAt), "ended_at": iso(session.endedAt),
                "revision": metadata.revision,
                "blocks": blocks.enumerated().map { ["id": $0.offset + 1, "started_at": iso($0.element.0), "ended_at": iso($0.element.1)] as [String: Any] },
                "attributions": attributions]
    }
    func normalizedBlocks(_ session: LocalSession) -> [(Date, Date)] {
        session.segments.compactMap { segment in
            let start = Date(timeIntervalSince1970: floor(segment.startedAt.timeIntervalSince1970))
            let end = Date(timeIntervalSince1970: floor(segment.endedAt.timeIntervalSince1970))
            return end > start ? (start, end) : nil
        }
    }
    private func history(_ route: Route, _ body: [String: Any], workspace: inout LocalWorkspace, plan: PlanCache) throws -> Any {
        let parts = route.parts, method = route.method
        let metadata = workspace.webHistoryMetadata ?? [:]
        let active = workspace.sessions.filter { metadata[$0.id.uuidString]?.deletedAt == nil }
        if parts == ["sessions"] {
            guard let limit = Int(route.query["limit"] ?? "50"), (1...100).contains(limit) else { throw failure("Choose a valid history page size.", 422) }
            let deleted = route.query["deleted"] == "true"
            let before = route.query["before_id"].flatMap(Int.init)
            if route.query["before_id"] != nil && (before ?? 0) < 1 { throw failure("Invalid history cursor.", 422) }
            return workspace.sessions.filter { session in
                guard let entry = metadata[session.id.uuidString] else { return false }
                return (entry.deletedAt != nil) == deleted && (before == nil || entry.id < before!)
            }.sorted { metadata[$0.id.uuidString]!.id > metadata[$1.id.uuidString]!.id }.prefix(limit).map { sessionJSON($0, workspace: workspace, plan: plan) }
        }
        if parts.first == "sessions", parts.count >= 2, let id = Int(parts[1]) {
            guard let key = metadata.first(where: { $0.value.id == id })?.key,
                  let index = workspace.sessions.firstIndex(where: { $0.id.uuidString == key }), var entry = metadata[key] else { throw failure("Focus record not found.", 404) }
            if parts.count == 3 {
                entry.deletedAt = nil; workspace.webHistoryMetadata?[key] = entry
                return sessionJSON(workspace.sessions[index], workspace: workspace, plan: plan)
            }
            guard entry.deletedAt == nil else { throw failure("Focus record not found.", 404) }
            if method == "DELETE" { entry.deletedAt = Date(); workspace.webHistoryMetadata?[key] = entry; return ["deleted": true] }
            if method == "GET" { return sessionJSON(workspace.sessions[index], workspace: workspace, plan: plan) }
            guard let revision = body["revision"] as? Int, revision == entry.revision else { throw failure("This record changed. Reopen it to review the latest version.", 409) }
            let note = (body["summary"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            guard note.count <= 2000, let rows = body["attributions"] as? [[String: Any]], rows.count <= 300 else { throw failure("Keep the note under 2,000 characters and select at most 300 tasks.", 422) }
            var selections: [WorkSelection] = []
            let existing = workspace.sessions[index].selections ?? []
            for row in rows {
                let attribution = row["attribution_id"] as? Int, taskId = row["task_id"] as? Int
                guard (attribution == nil) != (taskId == nil) else { throw failure("Choose an existing attribution or a task.", 422) }
                var selection: WorkSelection
                if let attribution {
                    guard let old = existing.first(where: { entry.attributionIDs[String($0.taskId)] == attribution }) else { throw failure("This task no longer belongs to this record. Reopen it.", 422) }
                    selection = old
                } else {
                    guard let taskId, let (gi, ti) = taskIndex(taskId, plan) else { throw failure("A selected task no longer exists. Your changes have not been saved.", 404) }
                    selection = WorkSelection(task: plan.projects[gi].tasks[ti], project: plan.projects[gi])
                }
                guard !selections.contains(where: { $0.taskId == selection.taskId }) else { throw failure("Each task can appear only once in a session.", 422) }
                selection.completed = row.keys.contains("completed") ? try boolean(row, "completed") : false
                if entry.attributionIDs[String(selection.taskId)] == nil { entry.attributionIDs[String(selection.taskId)] = (entry.attributionIDs.values.max() ?? 0) + 1 }
                selections.append(selection)
            }
            workspace.sessions[index].note = note
            workspace.sessions[index].selections = selections
            entry.revision += 1; workspace.webHistoryMetadata?[key] = entry
            // Correcting a historical record deliberately never checks tasks in Plan.
            return sessionJSON(workspace.sessions[index], workspace: workspace, plan: plan)
        }
        if parts == ["export"] {
            return ["format": "flowlist", "schema_version": 1, "timestamps": "UTC", "exported_at": iso(Date()),
                    "goals": sortedProjects(plan).map { goalJSON($0) }, "tasks": plan.projects.flatMap(\.tasks).map(taskJSON),
                    "queue": plan.priorityIds.enumerated().map { ["task_id": $0.element, "position": $0.offset + 1] },
                    "sessions": workspace.sessions.map { session -> [String: Any] in
                        var row = sessionJSON(session, workspace: workspace, plan: plan)
                        row["client_id"] = session.id.uuidString
                        row["title"] = row["task_title"]
                        row["deleted_at"] = metadata[session.id.uuidString]?.deletedAt.map(iso) as Any? ?? NSNull()
                        return row
                    }] as [String: Any]
        }
        var calendar = Calendar(identifier: .gregorian)
        guard let zone = TimeZone(identifier: route.query["timezone"] ?? "UTC") else { throw failure("Unknown timezone.", 422) }
        calendar.timeZone = zone; calendar.firstWeekday = 2
        var days: [String: DayTotals] = [:]
        for session in active {
            guard let id = metadata[session.id.uuidString]?.id else { continue }
            for (day, value) in sessionDays(session, calendar: calendar) {
                var total = days[day] ?? DayTotals()
                total.seconds += value.seconds; total.minutes += value.minutes; total.ids.insert(id)
                days[day] = total
            }
        }
        if parts == ["history", "week"] {
            guard let startString = route.query["start"], let start = parseDay(startString, calendar: calendar) else { throw failure("Choose a valid calendar date.", 422) }
            let keys = (0..<7).map { dayKey(calendar.date(byAdding: .day, value: $0, to: start)!, calendar: calendar) }
            let rows: [[String: Any]] = keys.map { day in let row = days[day] ?? DayTotals(); return ["date": day, "minutes": row.minutes, "seconds": row.seconds, "session_ids": row.ids.sorted()] }
            let ids = Set(keys.flatMap { Array(days[$0]?.ids ?? []) })
            return ["days": rows, "sessions": active.filter { ids.contains(metadata[$0.id.uuidString]!.id) }.map { sessionJSON($0, workspace: workspace, plan: plan) }]
        }
        let today = calendar.startOfDay(for: Date())
        var cursor = (days[dayKey(today, calendar: calendar)]?.minutes ?? 0) > 0 ? today : calendar.date(byAdding: .day, value: -1, to: today)!
        var streak = 0
        while (days[dayKey(cursor, calendar: calendar)]?.minutes ?? 0) > 0 { streak += 1; cursor = calendar.date(byAdding: .day, value: -1, to: cursor)! }
        let stats = ["current_streak": streak, "total_sessions": active.count, "total_minutes": active.reduce(0) { $0 + normalizedBlocks($1).reduce(0) { $0 + Int($1.1.timeIntervalSince($1.0)) } / 60 }]
        if parts == ["stats"] { return stats }
        let weekday = calendar.component(.weekday, from: today)
        let monday = calendar.date(byAdding: .day, value: -((weekday + 5) % 7), to: today)!
        let first = dayKey(calendar.date(byAdding: .weekOfYear, value: -15, to: monday)!, calendar: calendar)
        let mondayKey = dayKey(monday, calendar: calendar), todayKey = dayKey(today, calendar: calendar)
        let weekIDs = days.filter { $0.key >= mondayKey && $0.key <= todayKey }.reduce(into: Set<Int>()) { $0.formUnion($1.value.ids) }
        let activity: [[String: Any]] = days.keys.sorted().filter { $0 >= first && $0 <= todayKey }.map { day in ["date": day, "sessions": days[day]!.ids.count, "minutes": days[day]!.minutes] }
        return ["stats": stats, "week_sessions": weekIDs.count, "activity": activity, "queue": queueJSON(plan),
                "goals": sortedProjects(plan).filter { !$0.completed }.map { ["goal": goalJSON($0), "tasks": $0.tasks.sorted(by: taskOrder).map(taskJSON)] }]
    }
    struct DayTotals { var seconds = 0; var minutes = 0; var ids: Set<Int> = [] }
    func sessionDays(_ session: LocalSession, calendar: Calendar) -> [String: DayTotals] {
        var values: [String: DayTotals] = [:], cumulative = 0
        for (start, end) in normalizedBlocks(session) {
            var cursor = start
            while cursor < end {
                let key = dayKey(cursor, calendar: calendar)
                let next = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: cursor))!
                let stop = min(end, next), seconds = Int(stop.timeIntervalSince(cursor))
                var row = values[key] ?? DayTotals()
                row.seconds += seconds; row.minutes += (cumulative + seconds) / 60 - cumulative / 60
                values[key] = row; cumulative += seconds; cursor = stop
            }
        }
        if values.isEmpty { values[dayKey(session.startedAt, calendar: calendar)] = DayTotals() }
        return values
    }
    func dayKey(_ date: Date, calendar: Calendar) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year!, parts.month!, parts.day!)
    }
    func parseDay(_ string: String, calendar: Calendar) -> Date? {
        let parts = string.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3, let date = calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2])), dayKey(date, calendar: calendar) == string else { return nil }
        return date
    }
}
