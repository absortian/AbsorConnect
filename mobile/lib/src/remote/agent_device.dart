import 'agent_protocol.dart';

enum HostMode { legacy, agent, unknown }

/// Declaración de la API: nunca sustituye la negociación autenticada ni el piloto.
class AgentDeviceInfo {
  const AgentDeviceInfo._(this.mode, [this.version, this.capabilities]);
  const AgentDeviceInfo.legacy() : this._(HostMode.legacy);
  const AgentDeviceInfo.unknown() : this._(HostMode.unknown);
  final HostMode mode;
  final String? version;
  final AgentCapabilities? capabilities;

  factory AgentDeviceInfo.fromRemote(Object? remote) {
    if (remote is! Map) return const AgentDeviceInfo.unknown();
    if (!remote.containsKey('mode')) return const AgentDeviceInfo.legacy();
    final version = remote['agentVersion'];
    final caps = remote['capabilities'];
    const keys = ['administration', 'login', 'secureAttention', 'restart'];
    if (remote['mode'] != 'agent' ||
        version is! String ||
        !RegExp(r'^[0-9A-Za-z.+-]{1,32}$').hasMatch(version) ||
        caps is! Map ||
        caps.length != keys.length ||
        !keys.every((k) => caps[k] is bool)) {
      return const AgentDeviceInfo.unknown();
    }
    return AgentDeviceInfo._(
      HostMode.agent,
      version,
      AgentCapabilities(
        administration: caps['administration'] as bool,
        login: caps['login'] as bool,
        secureAttention: caps['secureAttention'] as bool,
        restart: caps['restart'] as bool,
      ),
    );
  }

  /// Ninguna configuración final está aceptada todavía por el piloto exterior.
  bool get certifiedForTravel => false;
}

bool isRemoteDeviceId(String id) => RegExp(
  r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
).hasMatch(id);
