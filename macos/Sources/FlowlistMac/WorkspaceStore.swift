import Foundation
#if SWIFT_PACKAGE
import FlowlistCore
#endif

private struct QueueItem: Decodable { let task: PlanTask }

@MainActor extension TimerStore {
    var plan: PlanCache { workspace.planForEditing }
    var pendingCount: Int { workspace.sessions.filter { $0.needsUpload == true }.count }
    var canSwitchAccount: Bool { timer.phase == .idle && !busy && !connecting && !storageUnavailable }
    /// Commit acknowledgements and cache invalidation together. A crash between
    /// them must not leave a durable upload paired with stale dashboard totals.
    @discardableResult
    func invalidateWebCache(updating update: (inout LocalWorkspace) -> Void = { _ in }) -> Bool {
        webCacheGeneration += 1
        return change { state in
            update(&state)
            state.webResponseCache = nil
        }
    }

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
            try acceptAccount(credentials)
            Task { await self.sync() }
        } catch { self.error = error.localizedDescription }
    }
    func connectWithEmail(code: String) async throws {
        guard canSwitchAccount else { throw CloudFailure(message: "Save or discard your current session before signing in.") }
        connecting = true
        defer { connecting = false }
        let credentials = try await cloud.verifyEmailCode(code)
        try acceptAccount(credentials)
        Task { await self.sync() }
    }
    private func acceptAccount(_ credentials: CloudCredentials) throws {
        guard let rootFolder else { throw CloudFailure(message: "The local account folder is unavailable.") }
        let target = WorkspaceFile(url: try AccountFiles.workspaceURL(root: rootFolder, accountId: credentials.user.id))
        let loaded = try target.load()
        try cloud.install(credentials)
        file = target; workspace = loaded; account = credentials.user
        UserDefaults.standard.set(true, forKey: "flowlist.welcome.seen")
        error = nil; syncError = nil; lastSynced = nil
        webCacheGeneration += 1
        tick(); refreshReminders(); publishWidget()
    }
    func disconnect() {
        guard canSwitchAccount, let rootFolder else { error = "Finish and save your current session before signing out."; return }
        do {
            let guest = WorkspaceFile(url: try AccountFiles.workspaceURL(root: rootFolder, accountId: nil))
            let loaded = try guest.load()
            try cloud.signOut()
            file = guest; workspace = loaded; account = nil
            syncError = nil; lastSynced = nil
            tick(); refreshReminders(); publishWidget()
        } catch { self.error = error.localizedDescription }
    }
    func sync() async {
        guard let owner = account?.id, !busy, !storageUnavailable else { return }
        busy = true; lastSyncAttempt = Date(); syncError = nil
        defer {
            busy = false
            if syncError == nil && !(workspace.planOutbox ?? []).isEmpty { Task { await self.sync() } }
        }
        do {
            try await drainPlanOutbox(owner: owner)
            try await uploadPendingSessions(owner: owner)
            try await fetchPlan(owner: owner)
            let sessions: [RemoteSession] = try await cloud.request("/sessions?limit=100", owner: owner)
            guard account?.id == owner else { return }
            // A refresh is authoritative for recent records, including deletions from the web.
            let oldest = sessions.last?.id
            let older = oldest.map { id in (workspace.cloudHistory ?? []).filter { $0.id < id } } ?? []
            let history = sessions + (sessions.count == 100 ? older : [])
            if workspace.cloudHistory != history {
                guard invalidateWebCache(updating: { $0.cloudHistory = history }) else { return }
            }
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
    private func uploadPendingSessions(owner: String, taskIDs: Set<Int>? = nil) async throws {
        let pending = workspace.sessions.filter { $0.needsUpload == true && (taskIDs == nil || ($0.selections ?? []).contains { taskIDs!.contains($0.taskId) }) }
        for session in pending {
            // A focus session can refer to a task created offline. Upload it
            // only after Plan has assigned the server identity.
            if (session.selections ?? []).contains(where: { $0.taskId < 0 }) { continue }
            do {
                let saved: RemoteSession = try await cloud.request("/sessions", method: "POST", body: CloudJSON.encoder().encode(SessionUpload(session: session)), owner: owner)
                guard account?.id == owner else { return }
                guard invalidateWebCache(updating: { state in
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
    }
    func fetchPlan(owner: String) async throws {
        guard (workspace.planOutbox ?? []).isEmpty else { return }
        let revision = workspace.planRevision ?? 0
        let projects: [PlanProject] = try await cloud.request("/goals?include_tasks=true", owner: owner)
        let queue: [QueueItem] = try await cloud.request("/queue", owner: owner)
        guard account?.id == owner, (workspace.planOutbox ?? []).isEmpty, (workspace.planRevision ?? 0) == revision else { return }
        var cache = PlanCache(); cache.projects = projects; cache.priorityIds = queue.map { $0.task.id }; cache.refreshedAt = Date()
        // Keep local completion visible while its session is waiting to upload.
        for session in workspace.sessions where session.needsUpload == true {
            for selection in session.selections ?? [] where selection.completed { cache.setCompleted(selection.taskId, completed: true) }
        }
        cache.lowestAllocatedId = plan.lowestLocalId
        change { $0.plan = cache }
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
}

@MainActor extension TimerStore {
    /// Temporary IDs remain accepted by an already-rendered web form after sync.
    func translatePlanRequest(path: String, body: [String: Any]) -> (String, [String: Any]) {
        let aliases = workspace.planIDAliases ?? [:]
        func resolved(_ id: Int) -> Int { aliases[String(id)] ?? id }
        let parts = path.split(separator: "/", omittingEmptySubsequences: false).map { part -> String in
            guard let id = Int(part), id < 0 else { return String(part) }
            return String(resolved(id))
        }
        var values = body
        if let ids = values["ordered_ids"] as? [Int] { values["ordered_ids"] = ids.map(resolved) }
        for key in ["task_id", "goal_id", "parent_id"] { if let id = values[key] as? Int { values[key] = resolved(id) } }
        return (parts.joined(separator: "/"), values)
    }
    func drainPlanOutbox(owner: String) async throws {
        // Check the current server, not credentials saved by an older app. An
        // older deployment may silently ignore an unknown idempotency header.
        var supportsIdempotency: Bool?
        while let first = workspace.planOutbox?.first {
            guard account?.id == owner else { return }
            if (first.uncertain || (first.sending && first.createsRecord)) && first.usesIdempotency != true {
                change { $0.planOutbox?[0].uncertain = true; $0.planOutbox?[0].error = "The last upload was interrupted. Check the web workspace before retrying to avoid a duplicate." }
                throw CloudFailure(message: "Plan sync needs attention. Your changes are saved on this Mac.")
            }
            if first.createsRecord && supportsIdempotency == nil {
                supportsIdempotency = try await cloud.publicConfiguration().planIdempotency == true
                guard account?.id == owner else { return }
            }
            if first.usesIdempotency == true && supportsIdempotency != true {
                throw CloudFailure(message: "The server needs an update before this saved change can safely retry.", status: 409)
            }
            let requestKey = first.createsRecord && supportsIdempotency == true ? first.id : nil
            let body = try JSONSerialization.jsonObject(with: first.body) as? [String: Any] ?? [:]
            let (path, translated) = translatePlanRequest(path: first.path, body: body)
            // An earlier create must resolve all dependent IDs before transmission.
            guard !path.split(separator: "/").contains(where: { (Int($0) ?? 0) < 0 }),
                  !((translated["ordered_ids"] as? [Int]) ?? []).contains(where: { $0 < 0 }) else {
                throw CloudFailure(message: "A local task is waiting for its project to sync.")
            }
            if first.method == "DELETE", let deleted = first.deletedTaskIDs, !deleted.isEmpty {
                let ids = Set(deleted.map { workspace.planIDAliases?[String($0)] ?? $0 })
                // Upload the record before deleting its task, so the backend can
                // retain the task's historical snapshot instead of rejecting it.
                try await uploadPendingSessions(owner: owner, taskIDs: ids)
                if workspace.sessions.contains(where: { $0.needsUpload == true && ($0.selections ?? []).contains { ids.contains($0.taskId) } }) {
                    throw CloudFailure(message: "A saved focus session must sync before its task can be deleted in the cloud.")
                }
            }
            guard change({ $0.planOutbox?[0].sending = true; $0.planOutbox?[0].error = nil; $0.planOutbox?[0].usesIdempotency = requestKey != nil }) else { throw CloudFailure(message: "Couldn’t save the sync checkpoint on this Mac.") }
            do {
                let value: Any
                do { value = try await cloud.requestJSON(path, method: first.method, body: try JSONSerialization.data(withJSONObject: translated), owner: owner, idempotencyKey: requestKey) }
                catch let error as CloudFailure where error.status == 404 && first.method == "DELETE" { value = [:] }
                guard account?.id == owner, workspace.planOutbox?.first?.id == first.id else { return }
                var aliases: [String: Int] = [:]
                for (key, localID) in first.bindings {
                    guard let id = (value as? [String: Any])?[key] as? Int, id > 0 else { throw CloudFailure(message: "The server did not confirm the new item’s identity.") }
                    aliases[String(localID)] = id
                }
                guard change({ state in state.resolvePlanIDs(aliases); state.planOutbox?.removeFirst() }) else { return }
            } catch {
                guard account?.id == owner else { return }
                let failure = error as? CloudFailure
                let ambiguous = first.createsRecord && requestKey == nil && !(failure?.definitelyUnsent ?? false) && ((failure?.status ?? 0) == 0 || (failure?.status ?? 0) >= 500)
                change { state in
                    state.planOutbox?[0].sending = false
                    state.planOutbox?[0].uncertain = ambiguous
                    state.planOutbox?[0].error = ambiguous ? "The server may have received this item. Check the web workspace before retrying to avoid a duplicate." : error.localizedDescription
                }
                throw error
            }
        }
    }
    func retryPlanChanges(confirmUncertain: Bool) async throws {
        guard !busy else { return }
        if workspace.planOutbox?.first?.uncertain == true && !confirmUncertain {
            throw CloudFailure(message: "Check the web workspace before retrying this interrupted upload.", status: 409)
        }
        if !(workspace.planOutbox ?? []).isEmpty {
            guard change({ $0.planOutbox?[0].uncertain = false; $0.planOutbox?[0].sending = false }) else { return }
        }
        await sync()
    }
}
