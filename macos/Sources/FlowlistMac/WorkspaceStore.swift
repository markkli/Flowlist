import Foundation
#if SWIFT_PACKAGE
import FlowlistCore
#endif

private struct QueueItem: Decodable { let task: PlanTask }
struct IgnoredResponse: Decodable {}

@MainActor extension TimerStore {
    var plan: PlanCache { workspace.plan ?? PlanCache() }
    var pendingCount: Int { workspace.sessions.filter { $0.needsUpload == true }.count }
    var canSwitchAccount: Bool { timer.phase == .idle && !busy && !connecting && !storageUnavailable }
    var priorities: [PlanTask] {
        plan.priorityIds.compactMap { id in plan.availableTasks.first { $0.id == id } }
    }
    func project(for task: PlanTask) -> PlanProject? { plan.projects.first { $0.id == task.goalId } }
    func refreshIfNeeded() {
        guard Date().timeIntervalSince(lastSyncAttempt) > 60 else { return }
        Task { await sync() }
    }
    func connect() async {
        guard canSwitchAccount else { error = "Finish and save your current session before switching accounts."; return }
        connecting = true
        defer { connecting = false }
        do {
            let credentials = try await cloud.signIn()
            guard let rootFolder else { return }
            let target = WorkspaceFile(url: try AccountFiles.workspaceURL(root: rootFolder, accountId: credentials.user.id))
            let loaded = try target.load()
            try cloud.install(credentials)
            file = target; workspace = loaded; account = credentials.user
            error = nil; syncError = nil; lastSynced = nil; historyHasMore = true
            tick(); refreshReminders(); publishWidget()
            await sync()
        } catch { self.error = error.localizedDescription }
    }
    func disconnect() {
        guard canSwitchAccount, let rootFolder else { error = "Finish and save your current session before signing out."; return }
        do {
            let guest = WorkspaceFile(url: try AccountFiles.workspaceURL(root: rootFolder, accountId: nil))
            let loaded = try guest.load()
            try cloud.signOut()
            file = guest; workspace = loaded; account = nil
            syncError = nil; lastSynced = nil; historyHasMore = true
            tick(); refreshReminders(); publishWidget()
        } catch { self.error = error.localizedDescription }
    }
    func sync() async {
        guard let owner = account?.id, !busy, !storageUnavailable else { return }
        busy = true; lastSyncAttempt = Date(); syncError = nil
        defer { busy = false }
        do {
            // Always upload the persisted snapshot. Its UUID makes transport retries safe.
            let pending = workspace.sessions.filter { $0.needsUpload == true }
            for session in pending {
                do {
                    let saved: RemoteSession = try await cloud.request("/sessions", method: "POST", body: CloudJSON.encoder().encode(SessionUpload(session: session)), owner: owner)
                    guard account?.id == owner else { return }
                    guard change({ state in
                        if let i = state.sessions.firstIndex(where: { $0.id == session.id }) {
                            state.sessions[i].needsUpload = false; state.sessions[i].remoteId = saved.id
                            state.sessions[i].uploadError = nil; state.sessions[i].uploadErrorCode = nil
                        }
                        state.cloudHistory = [saved] + (state.cloudHistory ?? []).filter { $0.id != saved.id }
                    }) else { return }
                } catch {
                    guard account?.id == owner else { return }
                    let status = (error as? CloudFailure)?.status ?? 0
                    change { state in
                        if let i = state.sessions.firstIndex(where: { $0.id == session.id }) {
                            state.sessions[i].uploadError = error.localizedDescription
                            state.sessions[i].uploadErrorCode = status
                        }
                    }
                    if status != 404 && status != 422 { throw error }
                }
            }
            try await fetchPlan(owner: owner)
            let sessions: [RemoteSession] = try await cloud.request("/sessions?limit=100", owner: owner)
            guard account?.id == owner else { return }
            // A refresh is authoritative for recent records, including deletions from the web.
            let oldest = sessions.last?.id
            let older = oldest.map { id in (workspace.cloudHistory ?? []).filter { $0.id < id } } ?? []
            change { $0.cloudHistory = sessions + (sessions.count == 100 ? older : []) }
            historyHasMore = sessions.count == 100
            lastSynced = Date()
            if pendingCount > 0 { syncError = "Some sessions are waiting to sync. Open History to review them." }
        } catch {
            if account?.id == owner { syncError = error.localizedDescription }
        }
        // A session may have been saved while a network request was in flight.
        if workspace.sessions.contains(where: { $0.needsUpload == true && $0.uploadError == nil }), syncError == nil {
            Task { await self.sync() }
        }
    }
    private func fetchPlan(owner: String) async throws {
        let projects: [PlanProject] = try await cloud.request("/goals?include_tasks=true", owner: owner)
        let queue: [QueueItem] = try await cloud.request("/queue", owner: owner)
        guard account?.id == owner else { return }
        var cache = PlanCache(); cache.projects = projects; cache.priorityIds = queue.map { $0.task.id }; cache.refreshedAt = Date()
        // Keep local completion visible while its session is waiting to upload.
        for session in workspace.sessions where session.needsUpload == true {
            for selection in session.selections ?? [] where selection.completed { cache.setCompleted(selection.taskId, completed: true) }
        }
        change { $0.plan = cache }
    }
    func loadOlderHistory() async {
        guard let owner = account?.id, !busy, let oldest = workspace.cloudHistory?.last?.id else { return }
        busy = true; defer { busy = false }
        do {
            let older: [RemoteSession] = try await cloud.request("/sessions?limit=100&before_id=\(oldest)", owner: owner)
            guard account?.id == owner else { return }
            change { state in
                let existing = Set((state.cloudHistory ?? []).map(\.id))
                state.cloudHistory = (state.cloudHistory ?? []) + older.filter { !existing.contains($0.id) }
            }
            historyHasMore = older.count == 100
        } catch { self.error = error.localizedDescription }
    }
    @discardableResult func mutate(_ path: String, method: String, body: [String: Any] = [:], local: (inout PlanCache) -> Void) async -> Bool {
        guard !busy, !connecting, !storageUnavailable else { return false }
        guard let owner = account?.id else {
            var cache = plan; local(&cache)
            return change { $0.plan = cache }
        }
        busy = true; defer { busy = false }
        do {
            let _: IgnoredResponse = try await cloud.request(path, method: method, body: JSONSerialization.data(withJSONObject: body), owner: owner)
            try await fetchPlan(owner: owner)
            syncError = nil
            return true
        } catch {
            self.error = error.localizedDescription + " Refresh to check the result before repeating this change."
            return false
        }
    }
    func setCompleted(_ task: PlanTask, value: Bool) async {
        await mutate("/tasks/\(task.id)", method: "PATCH", body: ["completed": value]) { $0.setCompleted(task.id, completed: value) }
    }
    func prioritize(_ task: PlanTask) async {
        let selected = plan.priorityIds.contains(task.id)
        await mutate("/queue/\(task.id)", method: selected ? "DELETE" : "POST") { cache in
            if selected { cache.priorityIds.removeAll { $0 == task.id } } else { cache.priorityIds.append(task.id) }
        }
    }
    func movePriority(_ id: Int, offset: Int) async {
        var ids = plan.priorityIds
        guard let i = ids.firstIndex(of: id), ids.indices.contains(i + offset) else { return }
        ids.swapAt(i, i + offset)
        await mutate("/queue", method: "PUT", body: ["ordered_ids": ids]) { $0.priorityIds = ids }
    }
    func deleteTask(_ task: PlanTask) async {
        await mutate("/tasks/\(task.id)", method: "DELETE") { $0.deleteTask(task.id) }
    }
    func closeProject(_ project: PlanProject, completed: Bool) async {
        await mutate("/goals/\(project.id)", method: "PATCH", body: ["completed": completed]) { cache in
            if let i = cache.projects.firstIndex(where: { $0.id == project.id }) { cache.projects[i].completed = completed }
        }
    }
    func deleteProject(_ project: PlanProject) async {
        await mutate("/goals/\(project.id)", method: "DELETE") { cache in
            let ids = project.tasks.map(\.id)
            cache.projects.removeAll { $0.id == project.id }; cache.priorityIds.removeAll { ids.contains($0) }
        }
    }
    func renameTask(_ task: PlanTask, title: String) async -> Bool {
        await mutate("/tasks/\(task.id)", method: "PATCH", body: ["title": title]) { cache in
            for g in cache.projects.indices {
                if let i = cache.projects[g].tasks.firstIndex(where: { $0.id == task.id }) { cache.projects[g].tasks[i].title = title }
            }
        }
    }
    func renameProject(_ project: PlanProject, title: String) async -> Bool {
        await mutate("/goals/\(project.id)", method: "PATCH", body: ["title": title]) { cache in
            if let i = cache.projects.firstIndex(where: { $0.id == project.id }) { cache.projects[i].title = title }
        }
    }
    func createProject(title: String) async -> Bool {
        await mutate("/goals", method: "POST", body: ["title": title, "goal_type": "project"]) { cache in
            cache.projects.append(PlanProject(id: cache.nextLocalId, title: title, position: cache.projects.count))
        }
    }
    func createTask(title: String, projectId: Int?, parentId: Int?) async -> Bool {
        let path = parentId.map { "/tasks/\($0)/subtasks" } ?? projectId.map { "/goals/\($0)/tasks" } ?? "/standalone-tasks"
        return await mutate(path, method: "POST", body: ["title": title]) { cache in
            var goal = projectId
            if goal == nil {
                if let list = cache.projects.first(where: { $0.goalType == "standalone" }) { goal = list.id }
                else {
                    goal = cache.nextLocalId
                    cache.projects.append(PlanProject(id: goal!, title: "Tasks", goalType: "standalone", position: cache.projects.count))
                }
            }
            let id = cache.nextLocalId
            if let i = cache.projects.firstIndex(where: { $0.id == goal }) {
                cache.projects[i].tasks.append(PlanTask(id: id, goalId: goal!, parentId: parentId, title: title, position: cache.projects[i].tasks.count))
            }
        }
    }
    func selectWork(_ task: PlanTask, finished: Bool, value: Bool) {
        guard let project = project(for: task) else { return }
        change { state in
            var selected = state.selections ?? []
            if let i = selected.firstIndex(where: { $0.taskId == task.id }) {
                if finished { selected[i].completed = value } else if !value { selected.remove(at: i) }
            } else if value { selected.append(WorkSelection(task: task, project: project, completed: finished)) }
            state.selections = selected
        }
    }
    func savePendingAsGeneral(_ id: UUID) {
        guard !busy else { return }
        change { state in
            if let i = state.sessions.firstIndex(where: { $0.id == id && $0.needsUpload == true }) {
                state.sessions[i].selections = []; state.sessions[i].uploadError = nil; state.sessions[i].uploadErrorCode = nil
            }
        }
        Task { await sync() }
    }
    func editRemote(_ session: RemoteSession, note: String, attributions: [[String: Any]]) async -> Bool {
        guard let owner = account?.id, !busy else { return false }
        busy = true; defer { busy = false }
        do {
            let body: [String: Any] = ["revision": session.revision, "summary": note, "attributions": attributions]
            let updated: RemoteSession = try await cloud.request("/sessions/\(session.id)", method: "PATCH", body: JSONSerialization.data(withJSONObject: body), owner: owner)
            change { state in state.cloudHistory = (state.cloudHistory ?? []).map { $0.id == updated.id ? updated : $0 } }
            return true
        } catch {
            self.error = error.localizedDescription
            if (error as? CloudFailure)?.status == 409,
               let latest: RemoteSession = try? await cloud.request("/sessions/\(session.id)", owner: owner) {
                change { state in state.cloudHistory = (state.cloudHistory ?? []).map { $0.id == latest.id ? latest : $0 } }
            }
            return false
        }
    }
    func deleteRemote(_ session: RemoteSession) async {
        guard let owner = account?.id, !busy else { return }
        busy = true; defer { busy = false }
        do {
            let _: IgnoredResponse = try await cloud.request("/sessions/\(session.id)", method: "DELETE", owner: owner)
            change { $0.cloudHistory?.removeAll { $0.id == session.id } }
        } catch { self.error = error.localizedDescription }
    }
}
