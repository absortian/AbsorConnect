import 'dart:convert';
import 'package:flutter/foundation.dart';

import 'agent_protocol.dart';

/// Política del controlador; el host mantiene sus propios gates de captura/entrada.
class AgentViewerStatus {
  const AgentViewerStatus({
    required this.enabled,
    required this.sequence,
    required this.state,
    required this.imageAvailable,
    required this.inputAllowed,
    required this.sensitiveAllowed,
  });
  final bool enabled, imageAvailable, inputAllowed, sensitiveAllowed;
  final int sequence;
  final AgentContext state;
}

/// Una instancia por PeerConnection autenticada. Se descarta al reconectar.
class AgentViewerState {
  bool _enabled = false, _sensitiveTainted = false;
  AgentCapabilities? _capabilities;
  AgentContextMessage? _context;
  List<AgentAction> _actions = const [];
  List<AgentAction> get actions => List.unmodifiable(_actions);

  bool announce(Object? version, Object? supported) {
    if (_enabled || version != 1 || supported != true) return false;
    _enabled = true;
    return true;
  }

  bool accept(String raw) {
    if (!_enabled) return false;
    switch (parseAgentHostMessage(raw)) {
      case AgentCapabilitiesMessage(:final capabilities, :final actions):
        if (jsonEncode(_capabilities?.toJson()) ==
            jsonEncode(capabilities.toJson()) && listEquals(_actions, actions)) {
          return false;
        }
        _capabilities = capabilities;
        _actions = List.of(actions);
        return true;
      case AgentContextMessage message:
        if (message.sequence <= (_context?.sequence ?? 0)) return false;
        // v1 no identifica el contexto de cada trozo: solo una conexión nueva
        // puede reactivar contenido sensible después de un cambio observado.
        if (_context != null || message.state != AgentContext.userDesktop) {
          _sensitiveTainted = true;
        }
        _context = message;
        return true;
      default:
        return false;
    }
  }

  AgentViewerStatus get status {
    final image = _capabilities != null && _context?.imageAvailable == true;
    final state = _context?.state ?? AgentContext.unavailable;
    final input =
        state == AgentContext.userDesktop ||
        ({AgentContext.login, AgentContext.locked}.contains(state) &&
            _capabilities?.login == true) ||
        (state == AgentContext.securePrompt &&
            _capabilities?.administration == true);
    return AgentViewerStatus(
      enabled: _enabled,
      sequence: _context?.sequence ?? 0,
      state: state,
      imageAvailable: !_enabled || image,
      inputAllowed: !_enabled || (image && input),
      sensitiveAllowed:
          !_enabled ||
          (image && state == AgentContext.userDesktop && !_sensitiveTainted),
    );
  }
}
