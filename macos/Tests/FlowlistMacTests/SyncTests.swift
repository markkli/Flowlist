import Foundation
import Testing
import FlowlistCore
@testable import FlowlistMac

private final class MemoryVault: AuthVault {
    var value: CloudCredentials?
    func read() throws -> CloudCredentials? { value }
    func write(_ credentials: CloudCredentials) throws { value = credentials }
    func clear() throws { value = nil }
}
private final class StubTransport: URLProtocol {
    static var respond: ((URLRequest) throws -> (Int, String))!
    static var asyncRespond: (@MainActor (URLRequest) async throws -> (Int, String))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
      Task {
        do {
            let status: Int, body: String
            if let asyncRespond = Self.asyncRespond { (status, body) = try await asyncRespond(request) }
            else { (status, body) = try Self.respond(request) }
            client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: Data(body.utf8))
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
      }
    }
    override func stopLoading() {}
}

@Suite(.serialized) @MainActor struct SyncTests {
    let user = CloudIdentity(id: "96a0694b-33ad-4c84-9a93-82a7c38aafad", email: "test@example.invalid")
    let remote = #"{"id":10,"task_title":"General focus","summary":"Draft","actual_minutes":1,"created_at":"2026-09-28T12:00:00","started_at":"2026-09-28T11:59:00","ended_at":"2026-09-28T12:00:00","revision":0,"blocks":[{"id":1,"started_at":"2026-09-28T11:59:00","ended_at":"2026-09-28T12:00:00"}],"attributions":[]}"#
    private func client(expired: Bool = false) throws -> (CloudClient, MemoryVault) {
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [StubTransport.self]
        let vault = MemoryVault()
        let client = CloudClient(transport: URLSession(configuration: config), vault: vault)
        try client.install(CloudCredentials(accessToken: "test-token", refreshToken: "test-refresh", expiresAt: Date().addingTimeInterval(expired ? -1 : 3600), user: user, configuration: PublicConfiguration(authMode: "supabase", supabaseUrl: "https://example.supabase.co", supabaseKey: "sb_publishable_test", googleEnabled: true)))
        return (client, vault)
    }
    func pending() -> LocalWorkspace {
        var state = LocalWorkspace()
        let start = Date().addingTimeInterval(-65)
        state.timer.start(configuration: state.configuration, at: start)
        state.timer.finish(at: start.addingTimeInterval(60))
        state.note = "Draft"; state.saveSession(upload: true)
        return state
    }
    @Test func emailSignInRequiresEnabledSenderAndVerifiesAccountBeforeReturningCredentials() async throws {
        let (client, _) = try client()
        var enabled = false, sent = 0
        let identity = self.user
        StubTransport.respond = { request in
            switch request.url!.path {
            case "/api/config": return (200, "{\"auth_mode\":\"supabase\",\"supabase_url\":\"https://example.supabase.co\",\"supabase_key\":\"sb_publishable_test\",\"email_enabled\":\(enabled),\"signup_enabled\":true}")
            case "/auth/v1/otp": sent += 1;return (200, "{}")
            case "/auth/v1/verify": return (200, "{\"access_token\":\"new-token\",\"refresh_token\":\"new-refresh\",\"expires_in\":3600,\"user\":{\"id\":\"\(identity.id)\",\"email\":\"\(identity.email)\"}}")
            case "/api/account":
                #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer new-token")
                return (200, "{\"id\":\"\(identity.id)\",\"email\":\"\(identity.email)\"}")
            default: Issue.record("Unexpected sign-in request");return (404,"{}")
            }
        }
        await #expect(throws: (any Error).self) { try await client.sendEmailCode(identity.email) }
        #expect(sent == 0)
        enabled = true
        try await client.sendEmailCode(identity.email)
        await #expect(throws: (any Error).self) { try await client.sendEmailCode(identity.email) }
        #expect(sent == 1)
        await #expect(throws: (any Error).self) { _ = try await client.verifyEmailCode("wrong") }
        let credentials = try await client.verifyEmailCode("123456")
        #expect(credentials.user == identity && credentials.accessToken == "new-token")
        #expect(client.credentials?.accessToken == "test-token") // Caller installs only after its local file is ready.
        await #expect(throws: (any Error).self) { _ = try await client.verifyEmailCode("123456") }
    }
    @Test func localPlanCRUDAndReviewWorkWithoutNetwork() async throws {
        let store = TimerStore(preview: LocalWorkspace())
        let bridge = WebBridge(store: store)
        _ = try await bridge.api.request(path: "/goals/with-task", method: "POST", body: [
            "title": "Learn Flowlist", "task": ["title": "Focus"]
        ])
        let parent = try #require(store.plan.projects.first?.tasks.first)
        _ = try await bridge.api.request(path: "/tasks/\(parent.id)/subtasks", method: "POST", body: ["title": "Clock settings"])
        let child = try #require(store.plan.projects.first?.tasks.last)
        _ = try await bridge.api.request(path: "/queue/\(child.id)", method: "POST")
        #expect(store.plan.priorityIds == [child.id])
        store.change {
            $0.timer.start(configuration: $0.configuration, at: Date().addingTimeInterval(-70))
            $0.timer.finish(at: Date())
        }
        _ = try await bridge.handle([
            "op": "timer", "action": "draft", "id": store.timer.id.uuidString,
            "summary": "Learned the clock", "selections": [["task_id": child.id, "completed": true]]
        ])
        _ = try await bridge.handle([
            "op": "api", "path": "/sessions", "method": "POST", "body": ["client_id": store.timer.id.uuidString]
        ])
        #expect(store.workspace.sessions.count == 1)
        #expect(store.plan.projects[0].tasks[1].completed)
        #expect(!store.plan.projects[0].tasks[0].completed)
    }

    @Test func verifiedSignInUnlocksLocalTimerBeforeBackgroundSync() async throws {
        let (client, _) = try client()
        let store = TimerStore(preview: LocalWorkspace(), client: client)
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        store.rootFolder = folder
        defer { StubTransport.asyncRespond = nil;try? FileManager.default.removeItem(at: folder) }
        let identity = self.user
        var syncReads = 0
        StubTransport.asyncRespond = { request in
            switch request.url!.path {
            case "/api/config": return (200, #"{"auth_mode":"supabase","supabase_url":"https://example.supabase.co","supabase_key":"sb_publishable_test","email_enabled":true}"#)
            case "/auth/v1/otp": return (200, "{}")
            case "/auth/v1/verify": return (200, "{\"access_token\":\"new-token\",\"refresh_token\":\"new-refresh\",\"expires_in\":3600,\"user\":{\"id\":\"\(identity.id)\",\"email\":\"\(identity.email)\"}}")
            case "/api/account": return (200, "{\"id\":\"\(identity.id)\",\"email\":\"\(identity.email)\"}")
            default:
                #expect(!store.connecting)
                syncReads += 1
                return (200, "[]")
            }
        }
        try await client.sendEmailCode(identity.email)
        try await store.connectWithEmail(code: "123456")
        #expect(!store.connecting && store.account == identity)
        store.change { $0.reminderPromptSeen = true } // Unit runner has no notification bundle.
        store.primaryAction()
        #expect(store.timer.phase == .focus)
        for _ in 0..<100 {
            if syncReads > 0 && !store.busy { break }
            try await Task.sleep(for: .milliseconds(10))
        }
        #expect(syncReads > 0 && !store.busy)
    }
    @Test func uncertainUploadRetriesSameIdAndOnlyMarksAcknowledgedSession() async throws {
        let (client, _) = try client()
        let store = TimerStore(preview: pending(), client: client); store.account = user
        let id = try #require(store.workspace.sessions.first?.id)
        StubTransport.respond = { _ in throw URLError(.networkConnectionLost) }
        await store.sync()
        #expect(store.pendingCount == 1 && store.workspace.sessions[0].remoteId == nil)
        let remote = self.remote
        var uploads = 0
        StubTransport.respond = { request in
            if request.httpMethod == "POST" {
                uploads += 1
                // URLProtocol exposes streamed bodies on some Foundation versions.
                let body = request.httpBody ?? {
                    guard let stream = request.httpBodyStream else { return Data() }
                    stream.open(); defer { stream.close() }
                    var data = Data(), buffer = [UInt8](repeating: 0, count: 1024)
                    while stream.hasBytesAvailable { let n = stream.read(&buffer, maxLength: buffer.count); if n <= 0 { break }; data.append(buffer, count: n) }
                    return data
                }()
                let object = try JSONSerialization.jsonObject(with: body) as? [String: Any]
                #expect(object?["client_id"] as? String == id.uuidString)
                return (200, remote)
            }
            return (200, request.url!.path == "/api/sessions" ? "[\(remote)]" : "[]")
        }
        await store.sync()
        #expect(uploads == 1 && store.pendingCount == 0)
        #expect(store.workspace.sessions[0].remoteId == 10)
        await store.sync()
        #expect(uploads == 1)
    }
    @Test func acknowledgedSessionInvalidatesCachedDashboardAndHistory() async throws {
        let (client, _) = try client()
        var workspace = pending()
        workspace.webCacheOwner = user.id
        workspace.webResponseCache = [
            "/dashboard?timezone=UTC": Data(#"{"stats":{"total_sessions":0}}"#.utf8),
            "/sessions?limit=100": Data("[]".utf8)
        ]
        let store = TimerStore(preview: workspace, client: client)
        store.account = user
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }
        store.file = WorkspaceFile(url: folder.appendingPathComponent("workspace.json"))
        let remote = self.remote
        StubTransport.respond = { request in
            if request.httpMethod == "POST" { return (200, remote) }
            return (200, request.url!.path == "/api/sessions" ? "[\(remote)]" : "[]")
        }
        await store.sync()
        #expect(store.pendingCount == 0)
        #expect(store.workspace.webResponseCache == nil)
        let restored = try #require(store.file).load()
        #expect(restored.sessions[0].needsUpload == false)
        #expect(restored.webResponseCache == nil)
    }

    @Test func expiredCredentialsRefreshOnceAndUseNewToken() async throws {
        let (client, vault) = try client(expired: true)
        let user = self.user
        var refreshes = 0
        StubTransport.respond = { request in
            if request.url!.path == "/auth/v1/token" {
                refreshes += 1
                return (200, "{\"access_token\":\"updated-token\",\"refresh_token\":\"updated-refresh\",\"expires_in\":3600,\"user\":{\"id\":\"\(user.id)\",\"email\":\"\(user.email)\"}}")
            }
            #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer updated-token")
            return (200, "[]")
        }
        let _: [PlanProject] = try await client.request("/goals", owner: user.id)
        let _: [PlanProject] = try await client.request("/goals", owner: user.id)
        #expect(refreshes == 1)
        #expect(vault.value?.refreshToken == "updated-refresh")
    }
    @Test func accountMismatchNeverSendsRequest() async throws {
        let (client, _) = try client()
        var calls = 0
        StubTransport.respond = { _ in calls += 1; return (200, "[]") }
        do {
            let _: [PlanProject] = try await client.request("/goals", owner: UUID().uuidString)
            Issue.record("Mismatched account accepted")
        } catch { }
        #expect(calls == 0)
    }
    @Test func deletedTaskKeepsSessionPendingUntilUserResolvesIt() async throws {
        let (client, _) = try client()
        let store = TimerStore(preview: pending(), client: client); store.account = user
        StubTransport.respond = { request in request.httpMethod == "POST" ? (404, #"{"detail":"Task not found"}"#) : (200, "[]") }
        await store.sync()
        #expect(store.pendingCount == 1)
        #expect(store.workspace.sessions[0].uploadErrorCode == 404)
        #expect(store.workspace.sessions[0].remoteId == nil)
    }
    @Test func signOutRestoresGuestFileWithoutMovingAccountHistory() throws {
        let (client, _) = try client()
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }
        var guest = LocalWorkspace(); guest.note = "Guest draft"
        try WorkspaceFile(url: AccountFiles.workspaceURL(root: folder, accountId: nil)).save(guest)
        let store = TimerStore(preview: pending(), client: client)
        store.account = user; store.rootFolder = folder
        let accountFile = WorkspaceFile(url: try AccountFiles.workspaceURL(root: folder, accountId: user.id))
        try accountFile.save(store.workspace); store.file = accountFile
        store.disconnect()
        #expect(store.account == nil && store.workspace.note == "Guest draft")
        #expect(store.workspace.sessions.isEmpty)
        #expect(try accountFile.load().sessions.count == 1)
    }
}
