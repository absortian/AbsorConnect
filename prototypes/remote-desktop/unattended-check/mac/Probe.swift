// Diagnóstico nativo de viabilidad. No guarda imagen, no inyecta entrada ni concede permisos.
import ApplicationServices
import CoreMedia
import Foundation
import ScreenCaptureKit

private final class FrameCounter: NSObject, SCStreamOutput, @unchecked Sendable {
  private let lock = NSLock()
  private var frames = 0

  var count: Int {
    lock.lock()
    defer { lock.unlock() }
    return frames
  }

  func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
              of type: SCStreamOutputType) {
    guard type == .screen, sampleBuffer.isValid,
          let attachments = CMSampleBufferGetSampleAttachmentsArray(
            sampleBuffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
          let status = attachments.first?[.status] as? Int,
          status == SCFrameStatus.complete.rawValue else { return }
    lock.lock()
    frames += 1
    lock.unlock()
  }
}

@main
private struct Probe {
  static func main() async {
    let arguments = Array(CommandLine.arguments.dropFirst())
    guard arguments.isEmpty || arguments == ["--probe"] || arguments == ["--capture"] else {
      FileHandle.standardError.write(Data("Uso: AbsorUnattendedProbe [--probe|--capture]\n".utf8))
      exit(64)
    }
    let capture = arguments == ["--capture"]
    let screenGranted = CGPreflightScreenCaptureAccess()
    let accessibilityGranted = AXIsProcessTrusted()
    let session = CGSessionCopyCurrentDictionary() as? [String: Any] ?? [:]
    var report: [String: Any] = [
      "schema": 1,
      "platform": "macos",
      "osVersion": ProcessInfo.processInfo.operatingSystemVersionString,
      "processUid": getuid(),
      "screenPermission": screenGranted,
      "accessibilityPermission": accessibilityGranted,
      "onConsole": session[kCGSessionOnConsoleKey as String] as? Bool ?? false,
      "loginComplete": session[kCGSessionLoginDoneKey as String] as? Bool ?? false,
      "captureRequested": capture,
      "captureTested": false,
      "inputTested": false,
      "preLoginTested": false,
      "readyForUnattended": false
    ]
    var result: Int32 = 0
    if capture {
      guard screenGranted else {
        report["status"] = "missing_screen_permission"
        report["reason"] = "El permiso debe concederse al prototipo antes de probar captura."
        emit(report)
        exit(2)
      }
      do {
        let content = try await SCShareableContent.excludingDesktopWindows(
          false, onScreenWindowsOnly: true)
        guard let display = content.displays.first else {
          report["status"] = "no_display"
          emit(report)
          exit(3)
        }
        let counter = FrameCounter()
        let configuration = SCStreamConfiguration()
        configuration.width = 320
        configuration.height = 180
        configuration.minimumFrameInterval = CMTime(value: 1, timescale: 5)
        configuration.queueDepth = 3
        configuration.capturesAudio = false
        configuration.showsCursor = false
        let filter = SCContentFilter(display: display, excludingWindows: [])
        let stream = SCStream(filter: filter, configuration: configuration, delegate: nil)
        try stream.addStreamOutput(counter, type: .screen,
                                   sampleHandlerQueue: DispatchQueue(label: "probe.frames"))
        try await stream.startCapture()
        try await Task.sleep(nanoseconds: 2_000_000_000)
        try await stream.stopCapture()
        report["captureTested"] = true
        report["completeFrames"] = counter.count
        report["displayCount"] = content.displays.count
        report["status"] = counter.count > 0 ? "capture_ok_not_certified" : "no_frames"
        result = counter.count > 0 ? 0 : 3
      } catch {
        let failure = error as NSError
        report["status"] = "capture_error"
        report["errorDomain"] = failure.domain
        report["errorCode"] = failure.code
        result = 3
      }
    } else {
      report["status"] = "probe_only_not_certified"
    }
    emit(report)
    exit(result)
  }

  private static func emit(_ report: [String: Any]) {
    do {
      let data = try JSONSerialization.data(withJSONObject: report,
                                            options: [.prettyPrinted, .sortedKeys])
      FileHandle.standardOutput.write(data)
      FileHandle.standardOutput.write(Data([10]))
    } catch {
      FileHandle.standardError.write(Data("No se pudo serializar el diagnóstico.\n".utf8))
      exit(1)
    }
  }
}
