import 'dart:convert';

/// Extensión opcional v1. Analizar no autentica ni autoriza ejecutar una orden.
const agentControlLimit = 2048;

enum AgentAction {
  lock('lock'),
  logout('logout'),
  restart('restart'),
  secureAttention('secure_attention');

  const AgentAction(this.wireName);
  final String wireName;
}

enum AgentContext {
  userDesktop('user_desktop'),
  locked('locked'),
  login('login'),
  securePrompt('secure_prompt'),
  transition('transition'),
  unavailable('unavailable');

  const AgentContext(this.wireName);
  final String wireName;
}

enum AgentError {
  notSupported('not_supported'),
  notAllowed('not_allowed'),
  busy('busy'),
  cancelled('cancelled'),
  systemError('system_error'),
  sessionExpired('session_expired');

  const AgentError(this.wireName);
  final String wireName;
}

class AgentCapabilities {
  const AgentCapabilities({
    required this.administration,
    required this.login,
    required this.secureAttention,
    required this.restart,
  });
  final bool administration, login, secureAttention, restart;
  Map<String, dynamic> toJson() => {
    'administration': administration,
    'login': login,
    'secureAttention': secureAttention,
    'restart': restart,
  };
}

sealed class AgentControlMessage {
  const AgentControlMessage();
  Map<String, dynamic> toJson();
}

sealed class AgentControllerMessage extends AgentControlMessage {
  const AgentControllerMessage();
}

sealed class AgentHostMessage extends AgentControlMessage {
  const AgentHostMessage();
}

class AgentControlEnable extends AgentControllerMessage {
  const AgentControlEnable();
  @override
  Map<String, dynamic> toJson() => _envelope('agent-control-enable');
}

class HostOperation extends AgentControllerMessage {
  const HostOperation({required this.id, required this.action});
  final String id;
  final AgentAction action;
  @override
  Map<String, dynamic> toJson() => {
    ..._envelope('host-operation'),
    'id': id,
    'action': action.wireName,
  };
}

class AgentCapabilitiesMessage extends AgentHostMessage {
  const AgentCapabilitiesMessage({
    required this.agentVersion,
    required this.capabilities,
    required this.actions,
  });
  final String agentVersion;
  final AgentCapabilities capabilities;
  final List<AgentAction> actions;
  @override
  Map<String, dynamic> toJson() => {
    ..._envelope('agent-capabilities'),
    'agentVersion': agentVersion,
    'capabilities': capabilities.toJson(),
    'actions': actions.map((a) => a.wireName).toList(),
  };
}

class AgentContextMessage extends AgentHostMessage {
  const AgentContextMessage({
    required this.sequence,
    required this.state,
    required this.imageAvailable,
  });
  final int sequence;
  final AgentContext state;
  final bool imageAvailable;
  @override
  Map<String, dynamic> toJson() => {
    ..._envelope('agent-context'),
    'sequence': sequence,
    'state': state.wireName,
    'imageAvailable': imageAvailable,
  };
}

enum HostOperationStatus { accepted, rejected, failed }

class HostOperationResult extends AgentHostMessage {
  const HostOperationResult({
    required this.id,
    required this.action,
    required this.status,
    this.code,
  });
  final String id;
  final AgentAction action;
  final HostOperationStatus status;
  final AgentError? code;
  @override
  Map<String, dynamic> toJson() => {
    ..._envelope('host-operation-result'),
    'id': id,
    'action': action.wireName,
    'status': status.name,
    if (code != null) 'code': code!.wireName,
  };
}

const _capabilityKeys = [
  'administration',
  'login',
  'secureAttention',
  'restart',
];
final _id = RegExp(
  r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
);
final _version = RegExp(r'^[0-9A-Za-z.+-]{1,32}$');
Map<String, dynamic> _envelope(String type) => {
  'v': 1,
  'extension': 1,
  'type': type,
};
bool _keys(Map data, List<String> expected) =>
    data.length == expected.length && expected.every(data.containsKey);
Map<String, dynamic>? _decode(String raw) {
  if (raw.length > agentControlLimit ||
      utf8.encode(raw).length > agentControlLimit) {
    return null;
  }
  try {
    final data = jsonDecode(raw);
    return data is Map<String, dynamic> &&
            data['v'] == 1 &&
            data['extension'] == 1
        ? data
        : null;
  } on FormatException {
    return null;
  }
}

AgentAction? _action(Object? value) =>
    AgentAction.values.where((a) => a.wireName == value).firstOrNull;
bool _operation(Map<String, dynamic> data) =>
    data['id'] is String &&
    _id.stringMatch(data['id'] as String) == data['id'] &&
    _action(data['action']) != null;

AgentControllerMessage? parseAgentControllerMessage(String raw) {
  final data = _decode(raw);
  if (data == null) return null;
  if (data['type'] == 'agent-control-enable' &&
      _keys(data, ['v', 'extension', 'type'])) {
    return const AgentControlEnable();
  }
  if (data['type'] == 'host-operation' &&
      _keys(data, ['v', 'extension', 'type', 'id', 'action']) &&
      _operation(data)) {
    return HostOperation(
      id: data['id'] as String,
      action: _action(data['action'])!,
    );
  }
  return null;
}

AgentHostMessage? parseAgentHostMessage(String raw) {
  final data = _decode(raw);
  if (data == null) return null;
  switch (data['type']) {
    case 'agent-capabilities':
      final version = data['agentVersion'],
          capabilities = data['capabilities'],
          actions = data['actions'];
      if (!_keys(data, [
            'v',
            'extension',
            'type',
            'agentVersion',
            'capabilities',
            'actions',
          ]) ||
          version is! String ||
          _version.stringMatch(version) != version ||
          capabilities is! Map ||
          !_keys(capabilities, _capabilityKeys) ||
          !_capabilityKeys.every((key) => capabilities[key] is bool) ||
          actions is! List ||
          actions.length > AgentAction.values.length ||
          actions.any((a) => _action(a) == null) ||
          actions.toSet().length != actions.length) {
        return null;
      }
      final parsed = AgentCapabilities(
        administration: capabilities['administration'] as bool,
        login: capabilities['login'] as bool,
        secureAttention: capabilities['secureAttention'] as bool,
        restart: capabilities['restart'] as bool,
      );
      if ((actions.contains('restart') && !parsed.restart) ||
          (actions.contains('secure_attention') && !parsed.secureAttention)) {
        return null;
      }
      return AgentCapabilitiesMessage(
        agentVersion: version,
        capabilities: parsed,
        actions: List.unmodifiable(actions.map((a) => _action(a)!)),
      );
    case 'agent-context':
      final sequence = data['sequence'], image = data['imageAvailable'];
      final state = AgentContext.values
          .where((s) => s.wireName == data['state'])
          .firstOrNull;
      if (!_keys(data, [
            'v',
            'extension',
            'type',
            'sequence',
            'state',
            'imageAvailable',
          ]) ||
          sequence is! num ||
          !sequence.isFinite ||
          sequence % 1 != 0 ||
          sequence < 1 ||
          sequence > 2147483647 ||
          state == null ||
          image is! bool ||
          ([
                AgentContext.transition,
                AgentContext.unavailable,
              ].contains(state) &&
              image)) {
        return null;
      }
      return AgentContextMessage(
        sequence: sequence.toInt(),
        state: state,
        imageAvailable: image,
      );
    case 'host-operation-result':
      if (!_operation(data)) return null;
      final status = HostOperationStatus.values
          .where((s) => s.name == data['status'])
          .firstOrNull;
      if (status == null) return null;
      if (status == HostOperationStatus.accepted &&
          _keys(data, ['v', 'extension', 'type', 'id', 'action', 'status'])) {
        return HostOperationResult(
          id: data['id'] as String,
          action: _action(data['action'])!,
          status: status,
        );
      }
      final code = AgentError.values
          .where((e) => e.wireName == data['code'])
          .firstOrNull;
      if (status != HostOperationStatus.accepted &&
          code != null &&
          _keys(data, [
            'v',
            'extension',
            'type',
            'id',
            'action',
            'status',
            'code',
          ])) {
        return HostOperationResult(
          id: data['id'] as String,
          action: _action(data['action'])!,
          status: status,
          code: code,
        );
      }
      return null;
    default:
      return null;
  }
}
