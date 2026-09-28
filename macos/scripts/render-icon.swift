import AppKit

// Rasterize the existing Flowlist SVG geometry for Apple's required icon sizes.
let destination = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)
for size in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let pixels = size * scale
        let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels,
                                  bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
                                  isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
        let transform = AffineTransform(translationByX: 0, byY: CGFloat(pixels))
        var scaleTransform = transform
        scaleTransform.scale(x: CGFloat(pixels) / 64, y: -CGFloat(pixels) / 64)
        (scaleTransform as NSAffineTransform).concat()
        NSColor(calibratedRed: 0.141, green: 0.149, blue: 0.133, alpha: 1).setFill()
        NSBezierPath(roundedRect: NSRect(x: 1, y: 1, width: 62, height: 62), xRadius: 15, yRadius: 15).fill()
        let border = NSBezierPath(roundedRect: NSRect(x: 6.5, y: 6.5, width: 51, height: 51), xRadius: 10, yRadius: 10)
        NSColor(calibratedRed: 0.765, green: 0.702, blue: 0.576, alpha: 0.5).setStroke()
        border.lineWidth = 1
        border.stroke()
        let f = NSBezierPath()
        f.move(to: NSPoint(x: 18, y: 17)); f.line(to: NSPoint(x: 46, y: 17)); f.line(to: NSPoint(x: 47, y: 27)); f.line(to: NSPoint(x: 45, y: 27))
        f.curve(to: NSPoint(x: 36, y: 19), controlPoint1: NSPoint(x: 43.8, y: 20.8), controlPoint2: NSPoint(x: 41.6, y: 19))
        f.line(to: NSPoint(x: 29, y: 19)); f.line(to: NSPoint(x: 29, y: 31)); f.line(to: NSPoint(x: 33, y: 31))
        f.curve(to: NSPoint(x: 39, y: 26), controlPoint1: NSPoint(x: 37, y: 31), controlPoint2: NSPoint(x: 38.7, y: 29.5))
        f.line(to: NSPoint(x: 41, y: 26)); f.line(to: NSPoint(x: 41, y: 38)); f.line(to: NSPoint(x: 39, y: 38))
        f.curve(to: NSPoint(x: 33, y: 33), controlPoint1: NSPoint(x: 38.7, y: 34.5), controlPoint2: NSPoint(x: 37, y: 33))
        f.line(to: NSPoint(x: 29, y: 33)); f.line(to: NSPoint(x: 29, y: 43))
        f.curve(to: NSPoint(x: 34, y: 47), controlPoint1: NSPoint(x: 29, y: 46), controlPoint2: NSPoint(x: 30.4, y: 46.5))
        f.line(to: NSPoint(x: 34, y: 49)); f.line(to: NSPoint(x: 18, y: 49)); f.line(to: NSPoint(x: 18, y: 47))
        f.curve(to: NSPoint(x: 23, y: 43), controlPoint1: NSPoint(x: 21.6, y: 46.5), controlPoint2: NSPoint(x: 23, y: 46))
        f.line(to: NSPoint(x: 23, y: 23))
        f.curve(to: NSPoint(x: 18, y: 19), controlPoint1: NSPoint(x: 23, y: 20), controlPoint2: NSPoint(x: 21.6, y: 19.5))
        f.close()
        NSColor(calibratedRed: 0.945, green: 0.922, blue: 0.867, alpha: 1).setFill()
        f.fill()
        NSGraphicsContext.restoreGraphicsState()
        let suffix = scale == 2 ? "@2x" : ""
        try rep.representation(using: .png, properties: [:])!.write(to: destination.appendingPathComponent("icon_\(size)x\(size)\(suffix).png"))
    }
}
