import Foundation
import Testing
import FlowlistCore
@testable import FlowlistMac

private final class APIAuthVault: AuthVault {
    var value: CloudCredentials?
    func read() throws -> CloudCredentials? { value }
    func write(_ credentials: CloudCredentials) throws { value = credentials }
    func clear() throws { value = nil }
}
private final class APITransport: URLProtocol {
    static var respond: ((URLRequest) throws -> (Int, String))!
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            let (status, body) = try Self.respond(request)
            client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: Data(body.utf8)); client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}

@Suite(.serialized) @MainActor struct WebWorkspaceAPITests {
    @Test func guestHierarchyPrioritiesAndCompletionMatchTheWebsite() async throws {
        let store = TimerStore(preview: LocalWorkspace()), api = WebWorkspaceAPI(store: TimerStore(preview: LocalWorkspace()))
        let local = WebWorkspaceAPI(store: store)
        let project = try #require(try await local.request(path: "/goals/with-task", method: "POST", body: ["title": "Research", "task": ["title": "Read paper"]]) as? [String: Any])
        let goalID = try #require(project["id"] as? Int)
        let taskID = try #require((project["tasks"] as? [[String: Any]])?.first?["id"] as? Int)
        let child = try #require(try await local.request(path: "/tasks/\(taskID)/subtasks", method: "POST", body: ["title": "Read abstract"]) as? [String: Any])
        let childID = try #require(child["id"] as? Int)
        _ = try await local.request(path: "/queue/\(childID)", method: "POST")
        #expect(store.priorities.map(\.id) == [childID])
        let options = try #require(try await local.request(path: "/focus-options") as? [[String: Any]])
        #expect(options.count == 2)
        #expect(options[1]["ancestor_titles"] as? [String] == ["Read paper"])
        await #expect(throws: (any Error).self) { _ = try await local.request(path: "/tasks/\(childID)/subtasks", method: "POST", body: ["title": "Too deep"]) }
        _ = try await local.request(path: "/tasks/\(childID)", method: "PATCH", body: ["completed": true])
        #expect(!store.plan.projects[0].tasks[0].completed)
        #expect((try await local.request(path: "/queue") as? [[String: Any]])?.isEmpty == true)
        _ = try await local.request(path: "/tasks/\(childID)", method: "PATCH", body: ["completed": false])
        #expect(store.priorities.map(\.id) == [childID])
        _ = try await local.request(path: "/tasks/\(taskID)", method: "PATCH", body: ["completed": true])
        #expect(store.plan.projects[0].tasks.allSatisfy { $0.completed })
        _ = try await local.request(path: "/goals/\(goalID)", method: "PATCH", body: ["completed": true])
        _ = try await local.request(path: "/tasks/\(childID)", method: "PATCH", body: ["completed": false])
        #expect(!store.plan.projects[0].completed && !store.plan.projects[0].tasks[0].completed)
        let before = store.workspace
        await #expect(throws: (any Error).self) { _ = try await local.request(path: "/goals/with-task", method: "POST", body: ["title": "No half project", "task": ["title": " "]]) }
        #expect(store.workspace == before)
        #expect((try await api.request(path: "/goals") as? [[String: Any]])?.isEmpty == true)
    }

    @Test func exampleIsIdempotentRemovableAndCannotRemoveUserProject() async throws {
        let store = TimerStore(preview: LocalWorkspace()), api: WebWorkspaceAPI
        api = WebWorkspaceAPI(store: store)
        let sample = try #require(try await api.request(path: "/guide/example", method: "POST") as? [String: Any])
        let again = try #require(try await api.request(path: "/guide/example", method: "POST") as? [String: Any])
        #expect(sample["id"] as? Int == again["id"] as? Int)
        #expect(store.plan.projects.count == 1 && store.plan.projects[0].tasks.count == 5)
        let id = try #require(sample["id"] as? Int)
        _ = try await api.request(path: "/guide/example/\(id)", method: "DELETE")
        let personal = try #require(try await api.request(path: "/goals", method: "POST", body: ["title": "My work"]) as? [String: Any])
        await #expect(throws: (any Error).self) { _ = try await api.request(path: "/guide/example/\(personal["id"] as! Int)", method: "DELETE") }
        #expect(store.plan.projects.count == 1)
        _ = try await api.request(path: "/account/onboarding", method: "PATCH", body: ["version": 4])
        #expect(store.workspace.webOnboardingVersion == 4)
    }

    @Test func historySplitEditRevisionSoftDeleteAndRestoreAreDurable() async throws {
        var workspace = LocalWorkspace()
        var project = PlanProject(id: -1, title: "Learning")
        let task = PlanTask(id: -2, goalId: -1, title: "Read")
        project.tasks = [task]; var plan = PlanCache(); plan.projects = [project]; workspace.plan = plan
        let date = ISO8601DateFormatter().date(from: "2026-09-27T23:59:30Z")!
        workspace.timer.start(configuration: workspace.configuration, at: date)
        workspace.timer.finish(at: date.addingTimeInterval(90))
        workspace.selections = [WorkSelection(task: task, project: project)]
        workspace.saveSession()
        let store = TimerStore(preview: workspace), api = WebWorkspaceAPI(store: TimerStore(preview: workspace))
        let local = WebWorkspaceAPI(store: store)
        let week = try #require(try await local.request(path: "/history/week?start=2026-09-25&timezone=UTC") as? [String: Any])
        let days = try #require(week["days"] as? [[String: Any]])
        #expect(days[2]["seconds"] as? Int == 30)
        #expect(days[3]["seconds"] as? Int == 60)
        #expect(days[2]["minutes"] as? Int == 0 && days[3]["minutes"] as? Int == 1)
        let records = try #require(try await local.request(path: "/sessions") as? [[String: Any]])
        let id = try #require(records.first?["id"] as? Int)
        let attributionID = try #require((records[0]["attributions"] as? [[String: Any]])?.first?["id"] as? Int)
        let body: [String: Any] = ["revision": 0, "summary": "A useful session", "attributions": [["attribution_id": attributionID, "completed": true]]]
        _ = try await local.request(path: "/sessions/\(id)", method: "PATCH", body: body)
        #expect(!store.plan.projects[0].tasks[0].completed)
        #expect(store.workspace.sessions[0].selections?.first?.completed == true)
        await #expect(throws: (any Error).self) { _ = try await local.request(path: "/sessions/\(id)", method: "PATCH", body: body) }
        _ = try await local.request(path: "/sessions/\(id)", method: "DELETE")
        #expect((try await local.request(path: "/sessions") as? [[String: Any]])?.isEmpty == true)
        #expect((try await local.request(path: "/sessions?deleted=true") as? [[String: Any]])?.count == 1)
        _ = try await local.request(path: "/sessions/\(id)/restore", method: "POST")
        let exported = try await local.request(path: "/export")
        #expect(JSONSerialization.isValidJSONObject(exported))
        let encoded = try JSONEncoder().encode(store.workspace)
        let restored = try JSONDecoder().decode(LocalWorkspace.self, from: encoded)
        #expect(restored.webHistoryMetadata == store.workspace.webHistoryMetadata)
        #expect(restored.sessions[0].note == "A useful session")
        #expect((try await api.request(path: "/sessions") as? [[String: Any]])?.first?["revision"] as? Int == 0)
    }

    @Test func deletingTheLastProjectCannotReuseHistoricalTaskIdentity() async throws {
        let store = TimerStore(preview: LocalWorkspace()), api: WebWorkspaceAPI
        api = WebWorkspaceAPI(store: store)
        let old = try #require(try await api.request(path: "/goals/with-task", method: "POST", body: ["title": "Old project", "task": ["title": "Old task"]]) as? [String: Any])
        let task = store.plan.projects[0].tasks[0]
        let oldGoalID = try #require(old["id"] as? Int)
        store.change { state in
            state.timer.start(configuration: state.configuration, at: Date().addingTimeInterval(-60))
            state.timer.finish(at: Date())
            state.selections = [WorkSelection(task: task, project: state.plan!.projects[0])]
            state.saveSession()
        }
        _ = try await api.request(path: "/goals/\(oldGoalID)", method: "DELETE")
        _ = try await api.request(path: "/standalone-tasks", method: "POST", body: ["title": "New task"])
        #expect(store.plan.projects[0].tasks[0].id < task.id)
        let history = try #require(try await api.request(path: "/sessions") as? [[String: Any]])
        let attribution = try #require((history[0]["attributions"] as? [[String: Any]])?.first)
        #expect(attribution["task_id"] is NSNull)
        #expect(attribution["task_title"] as? String == "Old task")
        // Seed an older workspace that predates the allocator, keeping only a
        // historical reference; its next task must also get a fresh identity.
        var legacy = store.workspace
        legacy.plan = nil
        let restored = TimerStore(preview: legacy)
        let restoredAPI = WebWorkspaceAPI(store: restored)
        _ = try await restoredAPI.request(path: "/standalone-tasks", method: "POST", body: ["title": "After upgrade"])
        #expect(restored.plan.projects[0].tasks[0].id < task.id)
    }

    @Test func cloudAllowlistPreservesJSONAndOnlyFallsBackForTransportFailure() async throws {
        let identity = CloudIdentity(id: "ac232c37-873e-4827-b6de-cd9424e6511f", email: "test@example.invalid")
        let configuration = URLSessionConfiguration.ephemeral; configuration.protocolClasses = [APITransport.self]
        let client = CloudClient(transport: URLSession(configuration: configuration), vault: APIAuthVault())
        try client.install(CloudCredentials(accessToken: "test-token", refreshToken: "test-refresh", expiresAt: Date().addingTimeInterval(3600), user: identity, configuration: PublicConfiguration(authMode: "supabase", supabaseUrl: "https://example.supabase.co", supabaseKey: "sb_publishable_test")))
        let store = TimerStore(preview: LocalWorkspace(), client: client); store.account = identity
        let api = WebWorkspaceAPI(store: store)
        var calls = 0
        APITransport.respond = { _ in calls += 1; return (200, #"{"current_streak":3,"total_sessions":4,"total_minutes":60}"#) }
        for path in ["https://evil.invalid/steal", "//evil.invalid/account", "/../account", "/%2e%2e/account", "/account?url=https://evil.invalid", "/sessions"] {
            await #expect(throws: (any Error).self) { _ = try await api.request(path: path, method: path == "/sessions" ? "POST" : "GET") }
        }
        #expect(calls == 0)
        let stats = try #require(try await api.request(path: "/stats") as? [String: Any])
        #expect(stats["current_streak"] as? Int == 3 && stats["currentStreak"] == nil)
        APITransport.respond = { _ in throw URLError(.notConnectedToInternet) }
        let cached = try #require(try await api.request(path: "/stats") as? [String: Any])
        #expect(cached["total_minutes"] as? Int == 60)
        APITransport.respond = { _ in (403, #"{"detail":"Account access revoked"}"#) }
        await #expect(throws: (any Error).self) { _ = try await api.request(path: "/stats") }
        store.account = CloudIdentity(id: UUID().uuidString, email: "other@example.invalid")
        APITransport.respond = { _ in throw URLError(.notConnectedToInternet) }
        await #expect(throws: (any Error).self) { _ = try await api.request(path: "/stats") }
    }
}
