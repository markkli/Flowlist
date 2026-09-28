import SwiftUI
import WebKit
import Combine

extension Notification.Name { static let flowlistNavigate = Notification.Name("flowlist.navigate") }
extension Notification.Name { static let flowlistWebAction = Notification.Name("flowlist.web-action") }

/// Serves only the installed UI bundle. Never loads executable content from the network.
final class WorkspaceAssetHandler: NSObject, WKURLSchemeHandler {
    let root: URL
    init(root: URL) { self.root = root.resolvingSymlinksInPath() }
    static func permitted(_ url: URL) -> Bool { url.scheme == "flowlist-app" && url.host == "workspace" && url.user == nil && url.password == nil && url.port == nil }
    func asset(for url: URL) -> URL? {
        guard Self.permitted(url), let path = url.path.removingPercentEncoding,
              !path.split(separator: "/").contains(".."), !path.contains("\\") else { return nil }
        let target = root.appendingPathComponent(path == "/" || path.isEmpty ? "index.html" : String(path.dropFirst()))
            .standardizedFileURL.resolvingSymlinksInPath()
        guard target.path.hasPrefix(root.path + "/") else { return nil }
        return target
    }
    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url, let target = asset(for: url),
              let data = try? Data(contentsOf: target) else {
            urlSchemeTask.didFailWithError(URLError(.fileDoesNotExist)); return
        }
        let mime = ["html":"text/html", "js":"text/javascript", "css":"text/css", "json":"application/json",
                    "svg":"image/svg+xml", "png":"image/png", "webp":"image/webp", "jpg":"image/jpeg",
                    "woff2":"font/woff2", "ico":"image/x-icon"][target.pathExtension] ?? "application/octet-stream"
        urlSchemeTask.didReceive(URLResponse(url: url, mimeType: mime, expectedContentLength: data.count, textEncodingName: "utf-8"))
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }
    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
}

struct WebWorkspaceView: NSViewRepresentable {
    @ObservedObject var store: TimerStore
    let openSettings: () -> Void
    func makeCoordinator() -> Coordinator { Coordinator(store: store, openSettings: openSettings) }
    func makeNSView(context: Context) -> WKWebView { context.coordinator.makeWebView() }
    func updateNSView(_ nsView: WKWebView, context: Context) { context.coordinator.bridge.openSettings = openSettings }

    @MainActor final class Coordinator: NSObject, WKScriptMessageHandlerWithReply, WKNavigationDelegate, WKUIDelegate {
        let bridge: WebBridge
        weak var webView: WKWebView?
        var observations: Set<AnyCancellable> = []
        var ready = false
        var owner: String?
        var lastSynced: Date?
        init(store: TimerStore, openSettings: @escaping () -> Void) {
            bridge = WebBridge(store: store)
            bridge.openSettings = openSettings
            owner = store.account?.id
            lastSynced = store.lastSynced
            super.init()
        }
        static var resources: URL? {
            if let root = Bundle.main.resourceURL?.appendingPathComponent("WebUI"), FileManager.default.fileExists(atPath: root.appendingPathComponent("index.html").path) { return root }
            #if SWIFT_PACKAGE
            return Bundle.module.resourceURL?.appendingPathComponent("Resources/WebUI")
            #else
            return nil
            #endif
        }
        func makeWebView() -> WKWebView {
            let configuration = WKWebViewConfiguration()
            if let root = Self.resources { configuration.setURLSchemeHandler(WorkspaceAssetHandler(root: root), forURLScheme: "flowlist-app") }
            configuration.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "flowlist")
            // Browser storage contains UI preferences only, never OAuth credentials.
            configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
            let view = WKWebView(frame: .zero, configuration: configuration)
            webView = view
            view.navigationDelegate = self; view.uiDelegate = self
            view.setValue(false, forKey: "drawsBackground")
            if Self.resources != nil { view.load(URLRequest(url: URL(string: "flowlist-app://workspace/")!)) }
            else { view.loadHTMLString("<h1>Flowlist could not load its interface</h1><p>Rebuild the app to restore its bundled website files. Your local data is unchanged.</p>", baseURL: nil) }
            bridge.store.objectWillChange
                .debounce(for: .milliseconds(40), scheduler: RunLoop.main)
                .sink { [weak self] _ in self?.publish() }.store(in: &observations)
            NotificationCenter.default.publisher(for: .flowlistNavigate).sink { [weak self] event in
                guard let tab = event.object as? AppTab else { return }
                self?.navigate(tab)
            }.store(in: &observations)
            NotificationCenter.default.publisher(for: .flowlistWebAction).sink { [weak self] event in
                guard let name = event.object as? String else { return }
                self?.webAction(name)
            }.store(in: &observations)
            return view
        }
        func publish() {
            guard ready, let webView else { return }
            if owner != bridge.store.account?.id {
                owner = bridge.store.account?.id; ready = false
                webView.reload(); return
            }
            webView.callAsyncJavaScript("window.dispatchEvent(new CustomEvent('flowlist:native-state',{detail:state}));", arguments: ["state": bridge.bootstrap()], in: nil, in: .page) { _ in }
            if lastSynced != bridge.store.lastSynced {
                lastSynced = bridge.store.lastSynced
                webView.callAsyncJavaScript("window.dispatchEvent(new CustomEvent('flowlist:native-refresh'));", arguments: [:], in: nil, in: .page) { _ in }
            }
        }
        func navigate(_ tab: AppTab) {
            guard ready else { AppRouting.pendingTab = tab; return }
            guard tab != .settings else { bridge.openSettings?(); return }
            AppRouting.pendingTab = nil
            let hash = tab == .today ? "dashboard" : tab == .plan ? "goals" : "history"
            webView?.callAsyncJavaScript("location.hash=tab;", arguments: ["tab": hash], in: nil, in: .page) { _ in }
        }
        func webAction(_ name: String) {
            guard ready else { AppRouting.pendingWebAction = name; return }
            AppRouting.pendingWebAction = nil
            webView?.callAsyncJavaScript("window.dispatchEvent(new CustomEvent(name));", arguments: ["name": name], in: nil, in: .page) { _ in }
        }
        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage,
                                   replyHandler: @escaping (Any?, String?) -> Void) {
            guard message.frameInfo.isMainFrame,
                  let origin = message.frameInfo.request.url, WorkspaceAssetHandler.permitted(origin),
                  let value = message.body as? [String: Any], JSONSerialization.isValidJSONObject(value),
                  let encoded = try? JSONSerialization.data(withJSONObject: value), encoded.count < 50_100_000 else {
                replyHandler(nil, "Untrusted workspace request."); return
            }
            if value["op"] as? String == "ready" {
                ready = true
                replyHandler(["ok": true, "value": NSNull()], nil)
                publish()
                if let tab = AppRouting.pendingTab { navigate(tab) }
                if let action = AppRouting.pendingWebAction { webAction(action) }
                return
            }
            Task { @MainActor in
                let owner = bridge.store.account?.id
                do {
                    let result = try await bridge.handle(value)
                    guard owner == bridge.store.account?.id || value["op"] as? String == "account" else {
                        replyHandler(["ok": false, "error": "The account changed. Please try again.", "status": 409], nil); return
                    }
                    replyHandler(["ok": true, "value": result], nil)
                    publish()
                } catch {
                    replyHandler(["ok": false, "error": error.localizedDescription, "status": (error as? CloudFailure)?.status ?? 0], nil)
                }
            }
        }
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { if ready { publish() } }
        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
            if WorkspaceAssetHandler.permitted(url) { decisionHandler(.allow); return }
            decisionHandler(.cancel)
            if navigationAction.navigationType == .linkActivated, ["https", "mailto"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }
        }
        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = navigationAction.request.url, navigationAction.navigationType == .linkActivated, url.scheme == "https" { NSWorkspace.shared.open(url) }
            return nil
        }
        func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
            guard let url = frame.request.url, WorkspaceAssetHandler.permitted(url) else { completionHandler(false); return }
            let alert = NSAlert(); alert.messageText = message
            alert.addButton(withTitle: "Continue"); alert.addButton(withTitle: "Cancel")
            if let window = webView.window { alert.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn) } }
            else { completionHandler(false) }
        }
        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { ready = false; webView.reload() }
    }
}
