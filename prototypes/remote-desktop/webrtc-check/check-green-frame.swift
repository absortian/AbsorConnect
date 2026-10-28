// Solo analiza un PNG del dispositivo de laboratorio; no captura ni modifica imágenes.
import Foundation
import ImageIO
import CoreGraphics

guard CommandLine.arguments.count == 2 else { exit(64) }
let url = URL(fileURLWithPath: CommandLine.arguments[1]) as CFURL
guard let source = CGImageSourceCreateWithURL(url, nil),
      let info = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
      let width = info[kCGImagePropertyPixelWidth] as? Int,
      let height = info[kCGImagePropertyPixelHeight] as? Int,
      width > 0, height > 0, width <= 5000, height <= 5000,
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil),
      let sample = image.cropping(to: CGRect(x: width / 4, y: height / 2, width: 1, height: 1)) else { exit(65) }
var pixel = [UInt8](repeating: 0, count: 4)
guard let context = CGContext(data: &pixel, width: 1, height: 1, bitsPerComponent: 8,
    bytesPerRow: 4, space: CGColorSpaceCreateDeviceRGB(),
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue) else { exit(66) }
context.draw(sample, in: CGRect(x: 0, y: 0, width: 1, height: 1))
let green = pixel[1] > 180 && pixel[0] < 80 && pixel[2] < 80
let result: [String: Any] = ["green": green, "width": width, "height": height]
let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
print(String(data: data, encoding: .utf8)!)
exit(green ? 0 : 1)
