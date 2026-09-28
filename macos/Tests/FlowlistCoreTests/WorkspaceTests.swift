import Foundation
import Testing
@testable import FlowlistCore

struct WorkspaceTests {
    func samplePlan() -> PlanCache {
        var plan = PlanCache()
        var project = PlanProject(id: -1, title: "Learn Flowlist")
        project.tasks = [PlanTask(id: -2, goalId: -1, title: "Understand focus"), PlanTask(id: -3, goalId: -1, parentId: -2, title: "Customize the clock")]
        plan.projects = [project]; plan.priorityIds = [-3]
        return plan
    }
    @Test func completingChildrenNeverCompletesParent() {
        var plan = samplePlan()
        plan.setCompleted(-3, completed: true)
        #expect(plan.projects[0].tasks[1].completed)
        #expect(!plan.projects[0].tasks[0].completed)
        plan.setCompleted(-2, completed: true)
        #expect(plan.projects[0].tasks.allSatisfy { $0.completed })
        plan.projects[0].completed = true
        plan.setCompleted(-3, completed: false)
        #expect(!plan.projects[0].completed)
        #expect(plan.projects[0].tasks.allSatisfy { !$0.completed })
    }
    @Test func deletingParentRemovesChildrenAndPriorityReferences() {
        var plan = samplePlan()
        #expect(plan.nextLocalId == -4)
        plan.deleteTask(-2)
        #expect(plan.projects[0].tasks.isEmpty)
        #expect(plan.priorityIds.isEmpty)
    }
    @Test func oldPrototypeDataStillLoadsWithoutNewFields() throws {
        var state = LocalWorkspace()
        state.timer.start(configuration: state.configuration, at: Date(timeIntervalSince1970: 1_700_000_000))
        state.timer.finish(at: Date(timeIntervalSince1970: 1_700_000_060))
        state.saveSession()
        var object = try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(state)) as? [String: Any])
        for key in ["plan", "selections", "cloudHistory"] { object.removeValue(forKey: key) }
        var sessions = try #require(object["sessions"] as? [[String: Any]])
        for key in ["selections", "needsUpload", "remoteId", "uploadError", "uploadErrorCode"] { sessions[0].removeValue(forKey: key) }
        object["sessions"] = sessions
        let restored = try JSONDecoder().decode(LocalWorkspace.self, from: JSONSerialization.data(withJSONObject: object))
        #expect(restored.isValid)
        #expect(restored.sessions[0].seconds == 60)
        #expect(restored.sessions[0].needsUpload == nil)
    }
    @Test func accountsAreSeparateAndCannotEscapeTheirFolder() throws {
        let root = URL(fileURLWithPath: "/tmp/flowlist-test")
        let a = UUID().uuidString, b = UUID().uuidString
        let guest = try AccountFiles.workspaceURL(root: root, accountId: nil)
        let accountA = try AccountFiles.workspaceURL(root: root, accountId: a)
        let accountB = try AccountFiles.workspaceURL(root: root, accountId: b)
        #expect(guest != accountA && accountA != accountB)
        #expect(try AccountFiles.workspaceURL(root: root, accountId: a.lowercased()) == accountA)
        #expect(throws: (any Error).self) { try AccountFiles.workspaceURL(root: root, accountId: "../../someone") }
    }
    @Test func oauthChallengeMatchesRFC7636() throws {
        let pkce = PKCE(verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")
        #expect(pkce.challenge == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
        let first = try PKCE.generate(), second = try PKCE.generate()
        #expect(first.verifier != second.verifier)
        #expect((43...128).contains(first.verifier.count))
    }
    @Test func oauthOnlyAcceptsOurCodeCallback() throws {
        #expect(try PKCE.callbackCode(URL(string: "flowlist://auth-callback?code=valid-code")!) == "valid-code")
        for value in ["https://other.example/?code=abc", "flowlist://today?code=abc", "flowlist://auth-callback?code=1&code=2", "flowlist://auth-callback?error=denied", "flowlist://auth-callback#access_token=secret", "flowlist://auth-callback?code="] {
            #expect(throws: (any Error).self) { try PKCE.callbackCode(URL(string: value)!) }
        }
    }
    @Test func savingOfflineCreatesOneRetryableSnapshot() throws {
        var state = LocalWorkspace()
        state.plan = samplePlan()
        state.timer.start(configuration: state.configuration, at: Date(timeIntervalSince1970: 1_700_000_000.25))
        state.timer.pause(at: Date(timeIntervalSince1970: 1_700_000_012.9))
        state.timer.resume(at: Date(timeIntervalSince1970: 1_700_000_030.25))
        state.timer.finish(at: Date(timeIntervalSince1970: 1_700_000_090.75))
        state.selections = [WorkSelection(task: state.plan!.projects[0].tasks[0], project: state.plan!.projects[0], completed: true)]
        state.note = "Progress"
        state.saveSession(upload: true); state.saveSession(upload: true)
        let session = try #require(state.sessions.first)
        #expect(state.sessions.count == 1 && session.needsUpload == true)
        #expect(state.plan!.projects[0].tasks.allSatisfy { $0.completed })
        #expect(state.selections == [])
        let first = SessionUpload(session: session)
        let second = SessionUpload(session: session)
        #expect(first.clientId == second.clientId)
        #expect(first.blocks.count == 2 && first.actualMinutes == 1)
        #expect(first.blocks.reduce(0) { $0 + $1.endedAt.timeIntervalSince($1.startedAt) } == 72)
        let json = try #require(JSONSerialization.jsonObject(with: CloudJSON.encoder().encode(first)) as? [String: Any])
        #expect(json["client_id"] as? String == session.id.uuidString)
        #expect(json["actual_minutes"] as? Int == 1)
        #expect((json["tasks"] as? [[String: Any]])?.first?["completed"] as? Bool == true)
    }
    @Test func cloudDatesAcceptNaiveUTCAndOffsets() throws {
        struct Value: Decodable { var date: Date }
        let utc = try CloudJSON.decoder().decode(Value.self, from: Data(#"{"date":"2026-09-28T12:00:00.123456"}"#.utf8)).date
        let west = try CloudJSON.decoder().decode(Value.self, from: Data(#"{"date":"2026-09-28T07:00:00.123456-05:00"}"#.utf8)).date
        #expect(abs(utc.timeIntervalSince(west)) < 0.001)
    }
    @Test func decodesExistingBackendSessionContract() throws {
        let data = Data(#"{"id":1,"task_title":"Focused work","summary":null,"actual_minutes":25,"created_at":"2026-09-28T12:00:00","started_at":"2026-09-28T11:35:00","ended_at":"2026-09-28T12:00:00","revision":0,"blocks":[{"id":1,"started_at":"2026-09-28T11:35:00","ended_at":"2026-09-28T12:00:00"}],"attributions":[{"id":2,"task_id":null,"task_title":"Archived task","goal_title":null,"completed":true}]}"#.utf8)
        let session = try CloudJSON.decoder().decode(RemoteSession.self, from: data)
        #expect(session.seconds == 1500)
        #expect(session.attributions[0].taskId == nil)
    }
}
