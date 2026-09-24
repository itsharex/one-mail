import AppKit
import CoreGraphics
import Foundation

// Run from the repository root: swift scripts/generate-tray-icons.swift src-tauri/icons
let iconDirectory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)

func render(size: Int, logicalSize: CGFloat, draw: (CGContext) -> Void) -> Data {
    let context = CGContext(
        data: nil,
        width: size,
        height: size,
        bitsPerComponent: 8,
        bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    )!
    context.scaleBy(x: CGFloat(size) / logicalSize, y: CGFloat(size) / logicalSize)
    context.setAllowsAntialiasing(true)
    context.setShouldAntialias(true)
    draw(context)
    return NSBitmapImageRep(cgImage: context.makeImage()!)
        .representation(using: .png, properties: [:])!
}

func envelope(in context: CGContext, frame: CGRect, lineWidth: CGFloat) {
    context.setLineWidth(lineWidth)
    context.setLineCap(.round)
    context.setLineJoin(.round)
    context.addPath(CGPath(
        roundedRect: frame,
        cornerWidth: lineWidth * 1.3,
        cornerHeight: lineWidth * 1.3,
        transform: nil
    ))
    context.strokePath()

    let left = frame.minX + lineWidth * 0.55
    let right = frame.maxX - lineWidth * 0.55
    let top = frame.maxY - lineWidth * 0.65
    let center = CGPoint(x: frame.midX, y: frame.midY - lineWidth * 0.2)
    context.move(to: CGPoint(x: left, y: top))
    context.addLine(to: center)
    context.addLine(to: CGPoint(x: right, y: top))
    context.strokePath()

    context.move(to: CGPoint(x: left, y: frame.minY + lineWidth * 0.65))
    context.addLine(to: CGPoint(x: frame.midX - lineWidth * 1.1, y: frame.midY + lineWidth * 0.65))
    context.move(to: CGPoint(x: right, y: frame.minY + lineWidth * 0.65))
    context.addLine(to: CGPoint(x: frame.midX + lineWidth * 1.1, y: frame.midY + lineWidth * 0.65))
    context.strokePath()
}

let mac = render(size: 36, logicalSize: 18) { context in
    context.setStrokeColor(CGColor(gray: 0, alpha: 1))
    envelope(in: context, frame: CGRect(x: 2.2, y: 3.3, width: 13.6, height: 11.4), lineWidth: 1.5)
}
try mac.write(to: iconDirectory.appendingPathComponent("tray-macos.png"))

func windowsIcon(size: Int) -> Data {
    render(size: size, logicalSize: 16) { context in
        context.setFillColor(CGColor(red: 0.10, green: 0.42, blue: 0.88, alpha: 1))
        context.addPath(CGPath(
            roundedRect: CGRect(x: 1, y: 1, width: 14, height: 14),
            cornerWidth: 3,
            cornerHeight: 3,
            transform: nil
        ))
        context.fillPath()
        context.setStrokeColor(CGColor(gray: 1, alpha: 1))
        envelope(in: context, frame: CGRect(x: 3, y: 4, width: 10, height: 8), lineWidth: 1.15)
    }
}

try windowsIcon(size: 16).write(to: iconDirectory.appendingPathComponent("tray-windows-16.png"))
try windowsIcon(size: 32).write(to: iconDirectory.appendingPathComponent("tray-windows-32.png"))
