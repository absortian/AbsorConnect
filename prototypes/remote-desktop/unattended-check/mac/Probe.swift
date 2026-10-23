// Diagnóstico nativo de viabilidad. No guarda imagen ni concede permisos.
// El modo opcional de puntero mueve ocho píxeles y restaura la posición, sin clics ni teclas.
import ApplicationServices
import CoreMedia
import Foundation
import ScreenCaptureKit
import Security

// El temporizador usa una cola independiente: una llamada bloqueada a un SDK no
// debe dejar la prueba indefinidamente activa ni borrar la última fase observada.
private final class ProbeDiagnostics: @unchecked Sendable {
  static let shared = ProbeDiagnostics()
  private let lock = NSLock()
  private var timer: DispatchSourceTimer?
  private var finished = false
  private var stage = "process_start"
  private var timeoutSeconds = 30
  private var progress: [String: Any] = [:]

  func start(timeout: Int = 30) {
    timeoutSeconds = timeout
    checkpoint("process_start")
    let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .utility))
    timer.schedule(deadline: .now() + .seconds(timeout))
    timer.setEventHandler { [self] in
      lock.lock()
      guard !finished else { lock.unlock(); return }
      finished = true
      var report = progress
      report["schema"] = 6
      report["platform"] = "macos"
      report["status"] = "diagnostic_timeout"
      report["lastStage"] = stage
      report["timeoutSeconds"] = timeoutSeconds
      report["captureTested"] = progress["captureTested"] ?? false
      report["inputTested"] = false
      report["completionUnverified"] = true
      report["readyForUnattended"] = false
      write(report)
      lock.unlock()
      _exit(70)
    }
    self.timer = timer
    timer.resume()
  }

  func recordProgress(_ report: [String: Any]) {
    lock.lock()
    defer { lock.unlock() }
    guard !finished else { return }
    progress = report
  }

  func checkpoint(_ name: String) {
    lock.lock()
    defer { lock.unlock() }
    guard !finished else { return }
    stage = name
    if let data = try? JSONSerialization.data(withJSONObject: ["stage": name]) {
      FileHandle.standardError.write(data)
      FileHandle.standardError.write(Data([10]))
    }
  }

  func finish(_ report: [String: Any]) {
    lock.lock()
    defer { lock.unlock() }
    guard !finished else { return }
    finished = true
    timer?.cancel()
    write(report)
  }

  private func write(_ report: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: report,
                                                options: [.prettyPrinted, .sortedKeys]) else {
      _exit(1)
    }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([10]))
  }
}

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
            || arguments == ["--capture-loginwindow"] || arguments == ["--capture-pointer-loginwindow"]
            || arguments == ["--watchdog-self-test"] else {
      FileHandle.standardError.write(Data("Uso: AbsorUnattendedProbe [--probe|--capture|--capture-loginwindow|--capture-pointer-loginwindow|--watchdog-self-test]\n".utf8))
      exit(64)
    }
    let diagnostics = ProbeDiagnostics.shared
    diagnostics.start(timeout: arguments == ["--watchdog-self-test"] ? 1 : 30)
    if arguments == ["--watchdog-self-test"] {
      diagnostics.checkpoint("watchdog_self_test_wait")
      try? await Task.sleep(nanoseconds: 5_000_000_000)
      diagnostics.finish(["schema": 6, "status": "watchdog_failed", "readyForUnattended": false])
      exit(71)
    }
    let pointer = arguments == ["--capture-pointer-loginwindow"]
    let retryLoginWindow = arguments == ["--capture-loginwindow"] || pointer
    let capture = arguments == ["--capture"] || retryLoginWindow
    diagnostics.checkpoint("permissions.screen")
    let screenGranted = CGPreflightScreenCaptureAccess()
    diagnostics.checkpoint("permissions.accessibility")
    let accessibilityGranted = AXIsProcessTrusted()
    diagnostics.checkpoint("session.current")
    let session = CGSessionCopyCurrentDictionary() as? [String: Any] ?? [:]
    var report: [String: Any] = [
      "schema": 6,
      "platform": "macos",
      "osVersion": ProcessInfo.processInfo.operatingSystemVersionString,
      "processUid": getuid(),
      "screenPermission": screenGranted,
      "accessibilityPermission": accessibilityGranted,
      "onConsole": session[kCGSessionOnConsoleKey as String] as? Bool ?? false,
      "loginComplete": session[kCGSessionLoginDoneKey as String] as? Bool ?? false,
      "captureRequested": capture,
      "captureTested": false,
      "pointerRequested": pointer,
      "pointerTested": false,
      "keyboardTested": false,
      "inputTested": false,
      "preLoginTested": false,
      "readyForUnattended": false
    ]
    report["graphicsContext"] = graphicsContext()
    var result: Int32 = 0
    if pointer && (getuid() != 0 || report["loginComplete"] as? Bool != false) {
      report["status"] = "loginwindow_context_required"
      emit(report)
      exit(4)
    }
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
      diagnostics.recordProgress(report)
      if pointer && result == 0 {
        let input = await checkPointer()
        report["pointer"] = input
        report["pointerTested"] = input["pointerTested"]
        report["inputTested"] = input["pointerTested"]
        report["inputScope"] = "pointer_movement_only"
        let success = input["moveObserved"] as? Bool == true && input["restoreObserved"] as? Bool == true
        report["status"] = success ? "capture_and_pointer_ok_not_certified" : "capture_ok_pointer_failed"
        result = success ? 0 : 4
      }
    } else {
      report["status"] = "probe_only_not_certified"
    }
    emit(report)
    exit(result)
  }

  private static func checkPointer() async -> [String: Any] {
    var report: [String: Any] = ["pointerTested": false, "moveObserved": false,
                               "restoreObserved": false, "requestedDistancePixels": 8,
                               "eventSource": "default"]
    ProbeDiagnostics.shared.checkpoint("pointer.session")
    let session = CGSessionCopyCurrentDictionary() as? [String: Any] ?? [:]
    guard getuid() == 0, session[kCGSessionLoginDoneKey as String] as? Bool == false,
          session[kCGSessionOnConsoleKey as String] as? Bool == true else {
      report["status"] = "loginwindow_context_required"
      return report
    }
    ProbeDiagnostics.shared.checkpoint("pointer.permissions")
    let postGranted = CGPreflightPostEventAccess()
    report["postEventPermission"] = postGranted
    guard AXIsProcessTrusted(), postGranted else {
      report["status"] = "missing_input_permission"
      return report
    }
    for button in [CGMouseButton.left, .right, .center] {
      if CGEventSource.buttonState(.combinedSessionState, button: button) {
        report["status"] = "pressed_mouse_button_prevents_probe"
        return report
      }
    }
    ProbeDiagnostics.shared.checkpoint("pointer.position")
    guard let initial = CGEvent(source: nil)?.location else {
      report["status"] = "pointer_position_unavailable"
      return report
    }
    ProbeDiagnostics.shared.checkpoint("pointer.display_bounds")
    let bounds = CGDisplayBounds(CGMainDisplayID())
    guard bounds.width > 20, bounds.contains(initial) else {
      report["status"] = "pointer_outside_main_display"
      return report
    }
    let target = CGPoint(x: initial.x + (initial.x + 8 < bounds.maxX ? 8 : -8), y: initial.y)
    // La API pública admite nil como fuente predeterminada; mismo permiso y tap.
    ProbeDiagnostics.shared.checkpoint("pointer.create_move")
    guard let move = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved,
                            mouseCursorPosition: target, mouseButton: .left) else {
      report["status"] = "pointer_event_unavailable"
      return report
    }
    ProbeDiagnostics.shared.checkpoint("pointer.create_restore")
    guard let restore = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved,
                               mouseCursorPosition: initial, mouseButton: .left) else {
      report["status"] = "pointer_event_unavailable"
      return report
    }
    var restored = false
    defer { if !restored { restore.post(tap: .cghidEventTap) } }
    ProbeDiagnostics.shared.checkpoint("pointer.post_move")
    move.post(tap: .cghidEventTap)
    report["pointerTested"] = true
    try? await Task.sleep(nanoseconds: 300_000_000)
    ProbeDiagnostics.shared.checkpoint("pointer.observe_move")
    if let observed = CGEvent(source: nil)?.location {
      report["moveObserved"] = abs(observed.x - target.x) <= 1 && abs(observed.y - target.y) <= 1
    }
    ProbeDiagnostics.shared.checkpoint("pointer.post_restore")
    restore.post(tap: .cghidEventTap)
    try? await Task.sleep(nanoseconds: 300_000_000)
    ProbeDiagnostics.shared.checkpoint("pointer.observe_restore")
    if let observed = CGEvent(source: nil)?.location {
      restored = abs(observed.x - initial.x) <= 1 && abs(observed.y - initial.y) <= 1
    }
    report["restoreObserved"] = restored
    report["status"] = report["moveObserved"] as? Bool == true && restored ? "pointer_ok_not_certified" : "pointer_not_verified"
    return report
  }

  private static func graphicsContext() -> [String: Any] {
    var identifier: SecuritySessionId = 0
    var attributes = SessionAttributeBits(rawValue: 0)
    ProbeDiagnostics.shared.checkpoint("graphics.security_session")
    let status = SessionGetInfo(callerSecuritySession, &identifier, &attributes)
    var displays = [CGDirectDisplayID](repeating: 0, count: 16)
    var count: UInt32 = 0
    ProbeDiagnostics.shared.checkpoint("graphics.online_displays")
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
      ProbeDiagnostics.shared.checkpoint("capture.shareable_content")
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
        ProbeDiagnostics.shared.checkpoint("capture.add_output")
        try stream.addStreamOutput(counter, type: .screen,
                                   sampleHandlerQueue: DispatchQueue(label: "probe.frames"))
        stage = "start_capture"
        ProbeDiagnostics.shared.checkpoint("capture.start_capture")
        try await stream.startCapture()
        stage = "count_frames"
        ProbeDiagnostics.shared.checkpoint("capture.count_frames")
        try await Task.sleep(nanoseconds: 2_000_000_000)
        stage = "stop_capture"
        ProbeDiagnostics.shared.checkpoint("capture.stop_capture")
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
    ProbeDiagnostics.shared.finish(report)
  }
}
