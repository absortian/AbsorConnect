// Diagnóstico nativo de viabilidad. No guarda imagen, no inyecta entrada ni concede permisos.
import ApplicationServices
import CoreMedia
import Foundation
import ScreenCaptureKit
import Security

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
    guard arguments.isEmpty || arguments == ["--probe"] || arguments == ["--capture"]
            || arguments == ["--capture-loginwindow"] else {
      FileHandle.standardError.write(Data("Uso: AbsorUnattendedProbe [--probe|--capture|--capture-loginwindow]\n".utf8))
      exit(64)
    }
    let retryLoginWindow = arguments == ["--capture-loginwindow"]
    let capture = arguments == ["--capture"] || retryLoginWindow
    let screenGranted = CGPreflightScreenCaptureAccess()
    let accessibilityGranted = AXIsProcessTrusted()
    let session = CGSessionCopyCurrentDictionary() as? [String: Any] ?? [:]
    var report: [String: Any] = [
      "schema": 2,
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
    report["graphicsContext"] = graphicsContext()
    var result: Int32 = 0
    if capture {
      guard screenGranted else {
        report["status"] = "missing_screen_permission"
        report["reason"] = "El permiso debe concederse al prototipo antes de probar captura."
        emit(report)
        exit(2)
      }
      // Solo se repite invalidContext: no se solicitan permisos ni se cambia de sesión.
      let started = DispatchTime.now().uptimeNanoseconds
      var attempts: [[String: Any]] = []
      for attempt in 0..<(retryLoginWindow ? 3 : 1) {
        if attempt > 0 {
          try? await Task.sleep(nanoseconds: attempt == 1 ? 3_000_000_000 : 5_000_000_000)
        }
        var outcome = await captureOnce()
        outcome["attempt"] = attempt + 1
        outcome["elapsedMilliseconds"] = (DispatchTime.now().uptimeNanoseconds - started) / 1_000_000
        attempts.append(outcome)
        result = outcome["status"] as? String == "capture_ok_not_certified" ? 0 : 3
        guard retryLoginWindow,
              outcome["errorStage"] as? String == "shareable_content",
              outcome["errorDomain"] as? String == "CoreGraphicsErrorDomain",
              outcome["errorCode"] as? Int == Int(CGError.invalidContext.rawValue) else { break }
      }
      if let finalAttempt = attempts.last {
        for (key, value) in finalAttempt { report[key] = value }
      }
      report["attempts"] = attempts
    } else {
      report["status"] = "probe_only_not_certified"
    }
    emit(report)
    exit(result)
  }

  private static func graphicsContext() -> [String: Any] {
    var identifier: SecuritySessionId = 0
    var attributes = SessionAttributeBits(rawValue: 0)
    let status = SessionGetInfo(callerSecuritySession, &identifier, &attributes)
    var displays = [CGDirectDisplayID](repeating: 0, count: 16)
    var count: UInt32 = 0
    let displayStatus = CGGetOnlineDisplayList(16, &displays, &count)
    var result: [String: Any] = [
      "securitySessionQueryStatus": status,
      "displayQueryStatus": displayStatus.rawValue
    ]
    if status == errSecSuccess {
      result["hasGraphicAccess"] = attributes.contains(.sessionHasGraphicAccess)
      result["isRootSecuritySession"] = attributes.contains(.sessionIsRoot)
    }
    if displayStatus == .success { result["onlineDisplayCount"] = count }
    return result
  }

  private static func captureOnce() async -> [String: Any] {
    var report: [String: Any] = ["captureTested": false, "graphicsContext": graphicsContext()]
    var stage = "shareable_content"
    do {
      let content = try await SCShareableContent.excludingDesktopWindows(
        false, onScreenWindowsOnly: true)
      report["displayCount"] = content.displays.count
      guard let display = content.displays.first else {
        report["status"] = "no_display"
        return report
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
        stage = "add_output"
        try stream.addStreamOutput(counter, type: .screen,
                                   sampleHandlerQueue: DispatchQueue(label: "probe.frames"))
        stage = "start_capture"
        try await stream.startCapture()
        stage = "count_frames"
        try await Task.sleep(nanoseconds: 2_000_000_000)
        stage = "stop_capture"
        try await stream.stopCapture()
        report["captureTested"] = true
        report["completeFrames"] = counter.count
        report["displayCount"] = content.displays.count
        report["status"] = counter.count > 0 ? "capture_ok_not_certified" : "no_frames"
      } catch {
        let failure = error as NSError
        report["status"] = "capture_error"
        report["errorDomain"] = failure.domain
        report["errorCode"] = failure.code
        report["errorStage"] = stage
      }
    return report
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
