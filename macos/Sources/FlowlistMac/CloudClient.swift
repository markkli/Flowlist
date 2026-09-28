import Foundation
import AppKit
import AuthenticationServices
import Security
#if SWIFT_PACKAGE
import FlowlistCore
#endif

struct CloudFailure: LocalizedError {
    let message: String
    var status = 0
    var errorDescription: String? { message }
}
struct PublicConfiguration: Codable {
    var authMode: String
    var supabaseUrl: String
    var supabaseKey: String
    var googleEnabled: Bool?
    func validate() throws {
        guard authMode == "supabase", let url = URL(string: supabaseUrl), url.scheme == "https",
              url.host?.hasSuffix(".supabase.co") == true, url.user == nil, url.password == nil,
              url.query == nil, url.fragment == nil, url.path.isEmpty,
              supabaseKey.hasPrefix("sb_publishable_") else {
            throw CloudFailure(message: "The server’s sign-in configuration is invalid.")
        }
    }
}
struct CloudIdentity: Codable, Equatable { let id: String; let email: String }
struct CloudCredentials: Codable {
    var accessToken: String
    var refreshToken: String
    var expiresAt: Date
    var user: CloudIdentity
    var configuration: PublicConfiguration
}
private struct TokenResponse: Decodable {
    var accessToken: String
    var refreshToken: String
    var expiresIn: Int
    var user: CloudIdentity
}

enum CredentialVault {
    private static var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "dev.flowlist.mac.auth", kSecAttrAccount as String: "supabase"]
    }
    static func read() throws -> CloudCredentials? {
        var request = query
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw CloudFailure(message: "Unlock your Mac’s Keychain to restore sign-in.") }
        return try JSONDecoder().decode(CloudCredentials.self, from: data)
    }
    static func write(_ credentials: CloudCredentials) throws {
        let data = try JSONEncoder().encode(credentials)
        var status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var values = query
            values[kSecValueData as String] = data
            values[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            status = SecItemAdd(values as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw CloudFailure(message: "Couldn’t save sign-in securely in Keychain. Please try again.") }
    }
    static func clear() throws {
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw CloudFailure(message: "Couldn’t remove sign-in from Keychain.") }
    }
}

protocol AuthVault {
    func read() throws -> CloudCredentials?
    func write(_ credentials: CloudCredentials) throws
    func clear() throws
}
struct SystemAuthVault: AuthVault {
    func read() throws -> CloudCredentials? { try CredentialVault.read() }
    func write(_ credentials: CloudCredentials) throws { try CredentialVault.write(credentials) }
    func clear() throws { try CredentialVault.clear() }
}

private final class NoRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}

@MainActor final class CloudClient: NSObject, ASWebAuthenticationPresentationContextProviding {
    static let origin = "https://flowlist-beta.onrender.com"
    private(set) var credentials: CloudCredentials?
    private var authentication: ASWebAuthenticationSession?
    private var refresh: Task<CloudCredentials, Error>?
    private var generation = UUID()
    private let transport: URLSession
    private let vault: any AuthVault
    init(transport: URLSession? = nil, vault: any AuthVault = SystemAuthVault()) {
        self.transport = transport ?? URLSession(configuration: .ephemeral, delegate: NoRedirects(), delegateQueue: nil)
        self.vault = vault
        super.init()
    }
    var identity: CloudIdentity? { credentials?.user }
    func restore() throws {
        if let saved = try vault.read() {
            try saved.configuration.validate()
            guard UUID(uuidString: saved.user.id) != nil else { throw CloudFailure(message: "Sign in again to restore this account.") }
            credentials = saved
        }
    }
    func install(_ value: CloudCredentials) throws {
        try vault.write(value)
        generation = UUID(); refresh?.cancel(); refresh = nil; credentials = value
    }
    func signOut() throws {
        try vault.clear()
        generation = UUID(); refresh?.cancel(); refresh = nil; credentials = nil
    }
    func signIn() async throws -> CloudCredentials {
        guard authentication == nil else { throw CloudFailure(message: "Sign-in is already open.") }
        let configuration: PublicConfiguration = try await fetch(URL(string: Self.origin + "/api/config")!)
        try configuration.validate()
        guard configuration.googleEnabled == true else { throw CloudFailure(message: "Google sign-in is not enabled on the server.") }
        let pkce = try PKCE.generate()
        var url = URLComponents(string: configuration.supabaseUrl + "/auth/v1/authorize")!
        url.queryItems = [URLQueryItem(name: "provider", value: "google"),
                          URLQueryItem(name: "redirect_to", value: "flowlist://auth-callback"),
                          URLQueryItem(name: "code_challenge", value: pkce.challenge),
                          URLQueryItem(name: "code_challenge_method", value: "s256")]
        defer { authentication = nil }
        let callback: URL = try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(url: url.url!, callbackURLScheme: "flowlist") { url, error in
                if let url { continuation.resume(returning: url) }
                else { continuation.resume(throwing: CloudFailure(message: "Sign-in was cancelled. Your local work is unchanged.")) }
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = true
            authentication = session
            if !session.start() {
                authentication = nil
                continuation.resume(throwing: CloudFailure(message: "Couldn’t open Google sign-in."))
            }
        }
        authentication = nil
        let code: String
        do { code = try PKCE.callbackCode(callback) }
        catch { throw CloudFailure(message: "The sign-in return wasn’t valid. Please start sign-in again.") }
        let value: TokenResponse = try await tokenRequest(configuration, grant: "pkce", body: ["auth_code": code, "code_verifier": pkce.verifier])
        let verified: CloudIdentity = try await fetch(URL(string: Self.origin + "/api/account")!, bearer: value.accessToken)
        guard verified.id == value.user.id, UUID(uuidString: verified.id) != nil else { throw CloudFailure(message: "Account verification failed.") }
        return CloudCredentials(accessToken: value.accessToken, refreshToken: value.refreshToken,
                                expiresAt: Date().addingTimeInterval(Double(value.expiresIn)), user: verified, configuration: configuration)
    }
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        NSApplication.shared.keyWindow ?? NSApplication.shared.windows.first ?? ASPresentationAnchor()
    }
    func request<T: Decodable>(_ path: String, method: String = "GET", body: Data? = nil, owner: String) async throws -> T {
        let epoch = generation
        guard identity?.id == owner else { throw CloudFailure(message: "The account changed. Please try again.") }
        let token = try await accessToken()
        do {
            let result: T = try await fetch(URL(string: Self.origin + "/api" + path)!, method: method, body: body, bearer: token)
            guard epoch == generation, identity?.id == owner else { throw CloudFailure(message: "The account changed. Your previous request has been ignored.") }
            return result
        } catch let error as CloudFailure where error.status == 401 {
            // A 401 means the application mutation did not execute. Retry once
            // with a refreshed token; never retry uncertain transport failures.
            let token = try await accessToken(forceRefresh: true)
            guard epoch == generation, identity?.id == owner else { throw CloudFailure(message: "The account changed.") }
            let result: T = try await fetch(URL(string: Self.origin + "/api" + path)!, method: method, body: body, bearer: token)
            guard epoch == generation else { throw CloudFailure(message: "The account changed.") }
            return result
        }
    }
    private func accessToken(forceRefresh: Bool = false) async throws -> String {
        guard let current = credentials else { throw CloudFailure(message: "Sign in to sync your workspace.", status: 401) }
        if !forceRefresh && current.expiresAt > Date().addingTimeInterval(60) { return current.accessToken }
        if let refresh { return try await refresh.value.accessToken }
        let epoch = generation
        let task = Task { @MainActor () throws -> CloudCredentials in
            let value: TokenResponse = try await self.tokenRequest(current.configuration, grant: "refresh_token", body: ["refresh_token": current.refreshToken])
            guard self.generation == epoch, value.user.id == current.user.id else { throw CloudFailure(message: "Sign-in changed. Please reconnect.", status: 401) }
            let updated = CloudCredentials(accessToken: value.accessToken, refreshToken: value.refreshToken,
                expiresAt: Date().addingTimeInterval(Double(value.expiresIn)), user: current.user, configuration: current.configuration)
            try self.vault.write(updated)
            self.credentials = updated
            return updated
        }
        refresh = task
        defer { if epoch == generation { refresh = nil } }
        return try await task.value.accessToken
    }
    private func tokenRequest<T: Decodable>(_ configuration: PublicConfiguration, grant: String, body: [String: String]) async throws -> T {
        try await fetch(URL(string: configuration.supabaseUrl + "/auth/v1/token?grant_type=" + grant)!, method: "POST",
                        body: JSONSerialization.data(withJSONObject: body), key: configuration.supabaseKey)
    }
    private func fetch<T: Decodable>(_ url: URL, method: String = "GET", body: Data? = nil, bearer: String? = nil, key: String? = nil) async throws -> T {
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 25)
        request.httpMethod = method; request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let bearer { request.setValue("Bearer " + bearer, forHTTPHeaderField: "Authorization") }
        if let key { request.setValue(key, forHTTPHeaderField: "apikey") }
        let data: Data, response: URLResponse
        do { (data, response) = try await transport.data(for: request) }
        catch { throw CloudFailure(message: "Couldn’t connect. Your local work is safe; check your connection and retry.") }
        guard let http = response as? HTTPURLResponse else { throw CloudFailure(message: "The server returned an invalid response.") }
        guard (200...299).contains(http.statusCode) else {
            let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            let message = object?["detail"] as? String ?? object?["msg"] as? String ?? object?["error_description"] as? String
            throw CloudFailure(message: message ?? "Couldn’t complete the request. Please retry.", status: http.statusCode)
        }
        do { return try CloudJSON.decoder().decode(T.self, from: data) }
        catch { throw CloudFailure(message: "The server response couldn’t be read. Refresh before trying again.") }
    }
}
