import AppKit
import SwiftUI
import WebKit

// Exercises the app's own bundled web UI against an in-memory preview workspace.
// This app has its own bundle ID and never restores credentials or user files.
@main struct WebWorkspaceSmoke {
    @MainActor static func main() {
        _ = NSApplication.shared
        NSApp.setActivationPolicy(.accessory)
        Task { @MainActor in
            do {
                try await run()
                print("PASS: bundled WebKit workspace smoke test")
                exit(EXIT_SUCCESS)
            } catch {
                fputs("FAIL: \(error.localizedDescription)\n", stderr)
                exit(EXIT_FAILURE)
            }
        }
        NSApp.run()
    }

    @MainActor static func run() async throws {
        guard Bundle.main.bundleIdentifier == "dev.flowlist.web-smoke" else { throw Failure("Refusing to run outside the isolated smoke-test app.") }
        UserDefaults.standard.removePersistentDomain(forName: "dev.flowlist.web-smoke")
        UserDefaults.standard.set(["appearance": ["preset": "coast", "focusArtwork": true, "planArtwork": true], "theme": "dark"], forKey: "flowlist.web.preferences.local")
        defer { UserDefaults.standard.removePersistentDomain(forName: "dev.flowlist.web-smoke") }

        let output = URL(fileURLWithPath: CommandLine.arguments.dropFirst().first ?? "build/previews", isDirectory: true)
        try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
        var sample = LocalWorkspace()
        var plan = PlanCache()
        var project = PlanProject(id: -1, title: "Learn to use Flowlist")
        project.tasks = [
            PlanTask(id: -2, goalId: -1, title: "Understand Pomodoro"),
            PlanTask(id: -3, goalId: -1, parentId: -2, title: "Customize the clock"),
            PlanTask(id: -4, goalId: -1, title: "Review your progress", position: 1)
        ]
        var tasks = PlanProject(id: -5, title: "Tasks", goalType: "standalone", position: 1)
        tasks.tasks = [PlanTask(id: -6, goalId: -5, title: "Read a chapter")]
        plan.projects = [project, tasks]
        plan.priorityIds = [-2, -6]
        sample.plan = plan
        sample.webOnboardingVersion = 1
        sample.soundEnabled = false
        sample.reminderPromptSeen = true
        var earlier = FocusTimer()
        earlier.start(configuration: sample.configuration, at: Date().addingTimeInterval(-3600))
        earlier.finish(at: Date().addingTimeInterval(-2400))
        if let session = LocalSession(timer: earlier, note: "Outlined the next chapter.", selections: [WorkSelection(task: project.tasks[0], project: project)]) { sample.sessions = [session] }
        let store = TimerStore(preview: sample)
        guard store.file == nil, store.rootFolder == nil, store.account == nil else { throw Failure("Preview workspace must be isolated from files and accounts.") }
        let isolatedData = FileManager.default.temporaryDirectory.appendingPathComponent("flowlist-web-smoke-\(UUID().uuidString)", isDirectory: true)
        store.file = WorkspaceFile(url: isolatedData.appendingPathComponent("workspace.json"))
        defer { try? FileManager.default.removeItem(at: isolatedData) }

        let coordinator = WebWorkspaceView.Coordinator(store: store, openSettings: {})
        guard WebWorkspaceView.Coordinator.resources != nil else { throw Failure("Bundled WebUI resource folder was not found.") }
        let web = coordinator.makeWebView()
        let window = NSWindow(contentRect: NSRect(x: 20, y: 40, width: 1440, height: 1060), styleMask: [.titled], backing: .buffered, defer: false)
        window.title = "Flowlist UI verification — sample data only"
        window.isReleasedWhenClosed = false
        window.contentView = web
        web.frame = NSRect(x: 0, y: 0, width: 1440, height: 1060)
        window.layoutIfNeeded()
        // WebKit pauses page animations/compositing in unpresented windows.
        // Present only this isolated test view; never capture/control other apps.
        window.orderFrontRegardless()
        defer { web.stopLoading(); window.close() }

        let errors = """
        window.__smokeErrors=[];
        window.addEventListener('error',e=>window.__smokeErrors.push(e.message || ('resource: '+e.target?.src)),true);
        window.addEventListener('unhandledrejection',e=>window.__smokeErrors.push(String(e.reason?.message || e.reason)));
        """
        web.configuration.userContentController.addUserScript(WKUserScript(source: errors, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        web.reload()
        do {
            try await wait(web, "document.body.classList.contains('app-ready') && document.querySelector('#top-date').textContent.length>0", label: "JavaScript module bootstrap")
            try await wait(web, "!document.querySelector('#view-dashboard').hasAttribute('aria-busy') && document.querySelector('#today-agenda').textContent.includes('Understand Pomodoro')", label: "local dashboard API")
            try await check(web, "location.protocol==='flowlist-app:' && location.host==='workspace'", "custom app scheme")
            try await check(web, "['.focus-card','.agenda-panel','.activity-panel','.goals-panel'].every(s=>{const e=document.querySelector(s);return e&&getComputedStyle(e).display!=='none'&&e.getBoundingClientRect().width>100})", "all four dashboard cards")
            try await check(web, "document.querySelector('#activity-heatmap').children.length>0 && document.querySelector('#dashboard-goals').textContent.includes('Learn to use Flowlist')", "activity and goal data")
            try await wait(web, "document.querySelector('.focus-atmosphere').complete && document.querySelector('.focus-atmosphere').naturalWidth>0", label: "bundled landscape image")
            try await snapshot(web, output.appendingPathComponent("web-today.png"))

            try await click(web, "#timer-settings-toggle")
            try await wait(web, "!document.querySelector('#timer-settings-overlay').classList.contains('hidden')", label: "timer settings dialog")
            try await check(web, "['#focus-minutes-setting','#break-minutes-setting','#rounds-setting','#long-break-minutes-setting'].every(s=>document.querySelector(s).value.length>0)", "four timer configuration fields")
            _ = try await web.evaluateJavaScript("document.querySelector('#focus-minutes-setting').value='30'; document.querySelector('#timer-settings-form').requestSubmit(); true;")
            try await wait(web, "document.querySelector('#timer-settings-overlay').classList.contains('hidden') && document.querySelector('#hero-time').textContent.includes('30:00')", label: "timer settings save")
            guard store.workspace.configuration.focusMinutes == 30 else { throw Failure("Timer settings did not reach the native timer.") }
            print("PASS: timer settings persist through the native bridge")

            try await click(web, "#nav-goals")
            try await wait(web, "!document.querySelector('#view-goals').classList.contains('hidden') && document.querySelector('[data-task-id=\"-3\"]')!==null", label: "Plan hierarchy")
            try await check(web, "document.querySelector('[data-task-id=\"-2\"] .subtask-list [data-task-id=\"-3\"]')!==null", "nested child inside its parent")
            try await check(web, "document.querySelector('[data-task-id=\"-2\"] .task-priority').getAttribute('aria-pressed')==='true'", "priority star state")
            try await snapshot(web, output.appendingPathComponent("web-plan.png"))

            try await click(web, "#nav-history")
            try await wait(web, "!document.querySelector('#view-history').classList.contains('hidden') && document.querySelector('#history-timeline').children.length>0 && !document.querySelector('#view-history').hasAttribute('aria-busy')", label: "history calendar")
            try await check(web, "document.querySelector('#history-week-label').textContent.length>0 && document.querySelector('#history-prev') && document.querySelector('#history-next')", "seven-day navigation")
            try await snapshot(web, output.appendingPathComponent("web-history.png"))

            try await click(web, "#appearance-toggle")
            try await wait(web, "!document.querySelector('#appearance-overlay').classList.contains('hidden')", label: "appearance choices")
            try await check(web, "document.querySelectorAll('[name=appearance-preset]').length===7", "seven appearance presets")
            try await click(web, "[name=appearance-preset][value=hills]")
            try await wait(web, "document.documentElement.dataset.appearance==='hills'", label: "landscape selection")
            try await click(web, "[name=appearance-preset][value=slate]")
            try await wait(web, "document.documentElement.dataset.appearance==='slate' && document.querySelector('.focus-card').classList.contains('is-solid')", label: "solid palette selection")
            try await click(web, "[name=appearance-preset][value=coast]")
            try await click(web, "#appearance-done")
            try await click(web, "#nav-dashboard")
            try await wait(web, "!document.querySelector('#view-dashboard').classList.contains('hidden')", label: "return to Home")

            try await click(web, "#start-pomodoro")
            try await wait(web, "!document.querySelector('#focus-overlay').classList.contains('hidden')", label: "native focus start")
            guard store.timer.phase == .focus else { throw Failure("Start focus did not start the native clock.") }
            try await Task.sleep(nanoseconds: 2_100_000_000)
            try await click(web, "#focus-exit")
            try await wait(web, "!document.querySelector('#session-attribution-overlay').classList.contains('hidden')", label: "end-session review")
            try await check(web, "document.querySelector('#session-summary') && document.querySelector('#attribution-options').textContent.includes('Understand Pomodoro') && document.querySelector('#attribution-options').textContent.includes('Customize the clock')", "note and task hierarchy in review")
            try await snapshot(web, output.appendingPathComponent("web-review.png"))
            guard store.timer.phase == .review, store.workspace.sessions.count == 1 else { throw Failure("Review must not silently save a session.") }
            let persisted = try store.file!.load()
            guard persisted.timer.phase == .review, persisted.configuration.focusMinutes == 30 else { throw Failure("Review and settings must persist in the isolated workspace file.") }
            print("PASS: native settings and review persisted to an isolated temporary file")
            _ = try await web.evaluateJavaScript("const note=document.querySelector('#session-summary');note.value='Smoke test: customized the clock.';note.dispatchEvent(new Event('input',{bubbles:true}));true;")
            try await click(web, "#attribution-options [data-task-id=\"-3\"] .attribution-finished-input")
            try await wait(web, "!document.querySelector('#save-session').disabled", label: "review ready to save")
            try await click(web, "#save-session")
            try await wait(web, "document.querySelector('#session-attribution-overlay').classList.contains('hidden')", label: "session saved")
            let saved = try store.file!.load()
            guard saved.sessions.count == 2, saved.sessions.first?.note == "Smoke test: customized the clock.",
                  saved.timer.phase == .idle,
                  saved.plan?.projects[0].tasks.first(where: { $0.id == -3 })?.completed == true,
                  saved.plan?.projects[0].tasks.first(where: { $0.id == -2 })?.completed == false else { throw Failure("Saving the review must retain notes and finish only the selected child.") }
            print("PASS: session note and child completion saved; parent remains open")
            try await check(web, "window.__smokeErrors.length===0", "no uncaught JavaScript errors")
            print("Snapshots: \(output.path)")
        } catch {
            if let diagnostic = try? await web.evaluateJavaScript("JSON.stringify({url:location.href,ready:document.readyState,errors:window.__smokeErrors||[],auth:document.querySelector('#auth-error')?.textContent,connection:document.querySelector('#connection-error-copy')?.textContent,body:document.body?.innerText.slice(0,1600)})") { print("Web diagnostic: \(diagnostic)") }
            throw error
        }
    }

    struct Failure: LocalizedError {
        let message: String
        init(_ message: String) { self.message = message }
        var errorDescription: String? { message }
    }
    @MainActor static func wait(_ web: WKWebView, _ predicate: String, label: String) async throws {
        let deadline = Date().addingTimeInterval(15)
        while Date() < deadline {
            if (try? await web.evaluateJavaScript("Boolean(\(predicate))")) as? Bool == true { print("PASS: \(label)"); return }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        throw Failure("Timed out: \(label)")
    }
    @MainActor static func check(_ web: WKWebView, _ predicate: String, _ label: String) async throws {
        guard (try await web.evaluateJavaScript("Boolean(\(predicate))")) as? Bool == true else { throw Failure("Assertion failed: \(label)") }
        print("PASS: \(label)")
    }
    @MainActor static func click(_ web: WKWebView, _ selector: String) async throws {
        _ = try await web.callAsyncJavaScript("const e=document.querySelector(selector);if(!e)throw new Error('Missing '+selector);e.click();return true;", arguments: ["selector": selector], in: nil, contentWorld: .page)
    }
    @MainActor static func snapshot(_ web: WKWebView, _ path: URL) async throws {
        _ = try await web.evaluateJavaScript("document.getAnimations().forEach(a=>{if(Number.isFinite(a.effect?.getComputedTiming().endTime))a.finish()}); true;")
        try await Task.sleep(nanoseconds: 200_000_000)
        try await check(web, "(()=>{const e=document.querySelector('.view:not(.hidden)');const r=e.getBoundingClientRect();const s=getComputedStyle(e);return Number(s.opacity)===1 && s.visibility==='visible' && r.width>500 && r.height>100})()", "visible page opacity and layout for \(path.lastPathComponent)")
        web.needsDisplay = true
        web.window?.displayIfNeeded()
        let configuration = WKSnapshotConfiguration()
        configuration.rect = web.bounds
        configuration.afterScreenUpdates = true
        let image = try await web.takeSnapshot(configuration: configuration)
        guard let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff), let data = bitmap.representation(using: .png, properties: [:]) else { throw Failure("Could not encode WebKit snapshot.") }
        try data.write(to: path)
    }
}
