// Ventana de diagnóstico propia: no escribe en loginwindow ni introduce credenciales.
import AppKit
import ApplicationServices

@MainActor
private final class InputProbeView: NSView {
  var downs = 0, ups = 0, escapes = 0, releases = 0
  override var acceptsFirstResponder: Bool { true }
  override func mouseDown(with event: NSEvent) { downs += 1 }
  override func mouseUp(with event: NSEvent) { ups += 1 }
  override func keyDown(with event: NSEvent) { if event.keyCode == 53 { escapes += 1 } }
  override func keyUp(with event: NSEvent) { if event.keyCode == 53 { releases += 1 } }
  override func draw(_ dirtyRect: NSRect) {
    NSColor.windowBackgroundColor.setFill()
    dirtyRect.fill()
    ("AbsorConnect — prueba local de entrada" as NSString).draw(
      at: NSPoint(x: 16, y: 44), withAttributes: [.foregroundColor: NSColor.labelColor])
  }
}

@MainActor
enum OwnedInputProbe {
  static var isVirtualMachine: Bool {
    var model = [CChar](repeating: 0, count: 128)
    var size = model.count
    return sysctlbyname("hw.model", &model, &size, nil, 0) == 0 &&
      String(cString: model).hasPrefix("VirtualMac")
  }

  static func run(checkpoint: @escaping (String) -> Void) -> [String: Any] {
    var report: [String: Any] = ["clickTested": false, "keyboardTested": false,
      "clickObserved": false, "escapeObserved": false, "credentialsTested": false,
      "inputScope": "owned_window_click_and_escape_only",
      "timerStrategy": "modal_run_loop"]
    checkpoint("owned_input.context")
    // No se admite este ensayo sobre el Mac físico ni en una sesión ya iniciada.
    guard isVirtualMachine, permittedContext() else {
      report["status"] = "virtual_loginwindow_context_required"
      return report
    }
    checkpoint("owned_input.position")
    guard let original = CGEvent(source: nil)?.location,
          let screen = NSScreen.main else {
      report["status"] = "display_or_pointer_unavailable"
      return report
    }
    checkpoint("owned_input.idle_state")
    for key in 0..<128 where CGEventSource.keyState(.combinedSessionState, key: CGKeyCode(key)) {
      report["status"] = "pressed_key_prevents_probe"
      return report
    }
    for button in [CGMouseButton.left, .right, .center] where CGEventSource.buttonState(.combinedSessionState, button: button) {
      report["status"] = "pressed_button_prevents_probe"
      return report
    }
    checkpoint("owned_input.application")
    let application = NSApplication.shared
    guard application.setActivationPolicy(.regular) else {
      report["status"] = "activation_policy_unavailable"
      return report
    }
    checkpoint("owned_input.window")
    let view = InputProbeView(frame: NSRect(x: 0, y: 0, width: 360, height: 100))
    let window = NSWindow(contentRect: view.bounds, styleMask: [.titled], backing: .buffered, defer: false)
    window.title = "AbsorConnect — diagnóstico"
    window.contentView = view
    window.isReleasedWhenClosed = false
    window.center()
    window.makeKeyAndOrderFront(nil)
    window.makeFirstResponder(view)
    application.activate(ignoringOtherApps: true)
    // Conversión AppKit → Quartz; no se guarda ninguna coordenada en los informes.
    let target = CGPoint(x: window.frame.midX, y: screen.frame.maxY - window.frame.midY)
    var cursorMoved = false
    defer {
      if cursorMoved { _ = CGWarpMouseCursorPosition(original) }
      window.orderOut(nil)
      window.close()
    }
    func ownsFocus() -> Bool {
      let modifiers: CGEventFlags = [.maskCommand, .maskControl, .maskAlternate, .maskShift, .maskSecondaryFn]
      let idle = CGEventSource.flagsState(.combinedSessionState).intersection(modifiers).isEmpty &&
        ![CGMouseButton.left, .right, .center].contains { CGEventSource.buttonState(.combinedSessionState, button: $0) }
      return idle && permittedContext() && window.isKeyWindow && window.firstResponder === view &&
        NSWorkspace.shared.frontmostApplication?.processIdentifier == getpid()
    }
    var completed = false
    var timers: [Timer] = []
    defer { timers.forEach { $0.invalidate() } }
    // runModal se ejecuta dentro de main() async: no puede depender de otra tarea
    // de la misma cola principal. El temporizador pertenece al bucle modal nativo.
    func after(_ delay: TimeInterval, _ action: @escaping @MainActor () -> Void) {
      let timer = Timer(timeInterval: delay, repeats: false) { _ in
        MainActor.assumeIsolated {
          guard !completed else { return }
          action()
        }
      }
      timers.append(timer)
      RunLoop.main.add(timer, forMode: .modalPanel)
    }
    func stop(_ status: String) {
      guard !completed else { return }
      completed = true
      report["status"] = status
      report["mouseDownCount"] = view.downs
      report["mouseUpCount"] = view.ups
      report["escapeDownCount"] = view.escapes
      report["escapeUpCount"] = view.releases
      report["clickObserved"] = view.downs == 1 && view.ups == 1
      report["escapeObserved"] = view.escapes == 1 && view.releases == 1
      application.stopModal()
    }
    after(1) {
      checkpoint("owned_input.click.focus")
      guard ownsFocus() else { stop("owned_window_focus_unavailable"); return }
      // Construir ambos eventos antes de publicar una pulsación evita una liberación ausente
      // si el SDK falla al construir el segundo. No se usan fuentes ni APIs privadas.
      checkpoint("owned_input.click.create")
      guard let down = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown,
                               mouseCursorPosition: target, mouseButton: .left),
            let up = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp,
                             mouseCursorPosition: target, mouseButton: .left) else {
        stop("mouse_event_unavailable"); return
      }
      checkpoint("owned_input.click.warp")
      guard CGWarpMouseCursorPosition(target) == .success else {
        stop("owned_pointer_target_unavailable"); return
      }
      cursorMoved = true
      guard ownsFocus() else { stop("owned_window_focus_unavailable"); return }
      down.flags = []
      up.flags = []
      checkpoint("owned_input.click.post")
      down.post(tap: .cghidEventTap)
      up.post(tap: .cghidEventTap)
      report["clickTested"] = true
      after(0.3) {
        checkpoint("owned_input.click.observe")
        guard ownsFocus(), view.downs == 1, view.ups == 1 else {
          stop("owned_click_not_observed"); return
        }
        checkpoint("owned_input.keyboard.create")
        guard let down = CGEvent(keyboardEventSource: nil, virtualKey: 53, keyDown: true),
              let up = CGEvent(keyboardEventSource: nil, virtualKey: 53, keyDown: false) else {
          stop("keyboard_event_unavailable"); return
        }
        down.flags = []
        up.flags = []
        checkpoint("owned_input.keyboard.post")
        down.post(tap: .cghidEventTap)
        up.post(tap: .cghidEventTap)
        report["keyboardTested"] = true
        after(0.3) {
          checkpoint("owned_input.keyboard.observe")
          stop(view.escapes == 1 && view.releases == 1 ? "owned_click_and_escape_observed" : "owned_escape_not_observed")
        }
      }
    }
    after(5) { stop("owned_window_timeout") }
    checkpoint("owned_input.modal")
    application.runModal(for: window)
    checkpoint("owned_input.modal.complete")
    if cursorMoved {
      report["cursorRestoreStatus"] = CGWarpMouseCursorPosition(original).rawValue
      cursorMoved = false
    }
    return report
  }

  private static func permittedContext() -> Bool {
    let session = CGSessionCopyCurrentDictionary() as? [String: Any] ?? [:]
    return getuid() == 0 && session[kCGSessionOnConsoleKey as String] as? Bool == true &&
      session[kCGSessionLoginDoneKey as String] as? Bool == false &&
      AXIsProcessTrusted() && CGPreflightPostEventAccess()
  }
}
