import SwiftUI

enum Landscape: String, CaseIterable, Identifiable {
    case coast, grove, hills, linen, sage, slate, clay
    var id: String { rawValue }
    var title: String { rawValue.capitalized }
    var accent: Color {
        switch self {
        case .coast, .slate: Color(red: 0.67, green: 0.82, blue: 0.87)
        case .grove, .sage: Color(red: 0.78, green: 0.83, blue: 0.65)
        case .hills: Color(red: 0.92, green: 0.78, blue: 0.62)
        case .linen: Color(red: 0.87, green: 0.83, blue: 0.76)
        case .clay: Color(red: 0.86, green: 0.75, blue: 0.71)
        }
    }
    var tint: Color {
        let theme = self
        return Color(nsColor: NSColor(name: nil) { appearance in
            let dark = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            switch theme {
            case .coast, .slate: return dark ? NSColor(red: 0.67, green: 0.82, blue: 0.87, alpha: 1) : NSColor(red: 0.20, green: 0.40, blue: 0.48, alpha: 1)
            case .grove, .sage: return dark ? NSColor(red: 0.78, green: 0.83, blue: 0.65, alpha: 1) : NSColor(red: 0.33, green: 0.42, blue: 0.23, alpha: 1)
            case .hills, .linen: return dark ? NSColor(red: 0.92, green: 0.78, blue: 0.62, alpha: 1) : NSColor(red: 0.51, green: 0.34, blue: 0.20, alpha: 1)
            case .clay: return dark ? NSColor(red: 0.86, green: 0.75, blue: 0.71, alpha: 1) : NSColor(red: 0.51, green: 0.32, blue: 0.29, alpha: 1)
            }
        })
    }
    var ink: Color {
        switch self {
        case .coast, .slate: Color(red: 0.07, green: 0.13, blue: 0.16)
        case .grove, .sage: Color(red: 0.12, green: 0.16, blue: 0.10)
        case .hills, .linen: Color(red: 0.20, green: 0.14, blue: 0.10)
        case .clay: Color(red: 0.20, green: 0.16, blue: 0.16)
        }
    }
}

enum Artwork {
    static var bundle: Bundle {
        if Bundle.main.url(forResource: "coast", withExtension: "jpg") != nil { return .main }
        #if SWIFT_PACKAGE
        return Bundle.module
        #else
        return Bundle.main
        #endif
    }
    private static let images: [String: NSImage] = {
        var result: [String: NSImage] = [:]
        for theme in Landscape.allCases {
            let url = bundle.url(forResource: theme.rawValue, withExtension: "jpg", subdirectory: "Resources")
                ?? bundle.url(forResource: theme.rawValue, withExtension: "jpg")
            if let url, let image = NSImage(contentsOf: url) { result[theme.rawValue] = image }
        }
        return result
    }()
    static func image(_ theme: Landscape) -> NSImage? {
        images[theme.rawValue]
    }
}

struct LandscapeBackground: View {
    let theme: Landscape
    var showArtwork = true
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                theme.ink
                if showArtwork, let image = Artwork.image(theme) {
                    Image(nsImage: image).resizable().scaledToFill()
                        .frame(width: geometry.size.width, height: geometry.size.height).clipped()
                }
                LinearGradient(colors: [theme.ink.opacity(0.84), theme.ink.opacity(0.48), .black.opacity(0.5)], startPoint: .leading, endPoint: .bottomTrailing)
            }
        }.accessibilityHidden(true)
    }
}

struct PrimaryButtonStyle: ButtonStyle {
    var theme: Landscape
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(.system(size: 15, weight: .semibold))
            .padding(.horizontal, 24).frame(minHeight: 44)
            .foregroundStyle(theme.ink)
            .background(theme.accent.opacity(configuration.isPressed ? 0.75 : 1), in: Capsule())
            .contentShape(Capsule())
    }
}

func focusDuration(_ seconds: TimeInterval) -> String {
    let count = Int(seconds)
    if count < 60 { return "\(count) \(count == 1 ? "second" : "seconds")" }
    let minutes = count / 60
    return "\(minutes) \(minutes == 1 ? "minute" : "minutes")"
}
