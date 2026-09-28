import Foundation
import CryptoKit
import Security

public struct PKCE {
    public let verifier: String
    public var challenge: String { Self.base64URL(Data(SHA256.hash(data: Data(verifier.utf8)))) }
    public init(verifier: String) { self.verifier = verifier }
    public static func generate() throws -> PKCE {
        var bytes = [UInt8](repeating: 0, count: 48)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw WorkspaceError.unsupportedOrDamaged }
        return PKCE(verifier: base64URL(Data(bytes)))
    }
    private static func base64URL(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
    public static func callbackCode(_ url: URL) throws -> String {
        guard url.scheme == "flowlist", url.host == "auth-callback", url.path.isEmpty || url.path == "/",
              url.fragment == nil, let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              !components.queryItems.orEmpty.contains(where: { $0.name == "error" }) else { throw WorkspaceError.unsupportedOrDamaged }
        let codes = components.queryItems.orEmpty.filter { $0.name == "code" }
        guard codes.count == 1, let code = codes.first?.value, !code.isEmpty, code.count <= 4096 else { throw WorkspaceError.unsupportedOrDamaged }
        return code
    }
}
private extension Optional where Wrapped == [URLQueryItem] { var orEmpty: [URLQueryItem] { self ?? [] } }
