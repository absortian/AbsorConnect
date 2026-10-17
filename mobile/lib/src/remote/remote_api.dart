import '../api.dart';
import '../session.dart';

/// Un PC de la cuenta (add-remote-desktop D4), como lo ve la sección Equipos del escritorio.
class RemoteDevice {
  RemoteDevice.fromJson(Map<String, dynamic> json)
      : id = json['id'] as String,
        name = json['name'] as String? ?? '',
        platform = json['platform'] as String? ?? '',
        online = json['online'] == true,
        remoteState = (json['remote'] as Map?)?['state'] as String? ?? 'disabled';

  final String id;
  final String name;

  /// `windows`, `macos` o `linux`.
  final String platform;
  final bool online;
  final String remoteState;

  /// `available`, `busy`, `disabled`, `missing_permissions`, `unsupported` u `offline`: sin
  /// conexión manda sobre lo último que publicó el PC.
  String get state => online ? remoteState : 'offline';

  bool get available => state == 'available';
}

/// En qué punto está una solicitud de sesión.
sealed class RequestStatus {
  const RequestStatus();
}

class RequestPending extends RequestStatus {
  const RequestPending();
}

class RequestAnswered extends RequestStatus {
  const RequestAnswered(this.answer);

  final String answer;
}

/// El PC la rechazó sin abrir conexión: `busy`, `locked`, `remote_disabled`…
class RequestRejected extends RequestStatus {
  const RequestRejected(this.reason, [this.retryAfter]);

  final String reason;
  final int? retryAfter;
}

/// Equipos, servidores ICE y solicitudes de sesión (add-remote-desktop D5), con el token de la
/// sesión de este móvil. Los errores son [ApiError] con el código del servicio.
class RemoteApi {
  RemoteApi(this.session);

  final Session session;

  Future<List<RemoteDevice>> devices() async {
    final data = await session.request('GET', '/api/devices') as Map<String, dynamic>?;
    return [
      for (final item in (data?['devices'] as List? ?? const []))
        if (item is Map<String, dynamic>) RemoteDevice.fromJson(item),
    ];
  }

  /// STUN y TURN para `RTCPeerConnection`. Sin ellos (fallo del servicio) solo se prueban los
  /// candidatos locales, igual que en el escritorio.
  Future<List<Map<String, dynamic>>> iceServers() async {
    try {
      final data = await session.request('GET', '/api/remote/ice-servers') as Map<String, dynamic>?;
      return [
        for (final server in (data?['iceServers'] as List? ?? const []))
          if (server is Map<String, dynamic>) server,
      ];
    } on ApiError catch (error) {
      if (error.status == 401) rethrow;
      return const [];
    }
  }

  /// Publica la oferta completa (vanilla ICE) y devuelve el id de la solicitud.
  Future<String> createRequest(String deviceId, String offer) async {
    final data = await session.request('POST', '/api/devices/$deviceId/remote-requests', body: {'offer': offer}) as Map<String, dynamic>;
    return data['id'] as String;
  }

  Future<RequestStatus> poll(String requestId) async {
    final data = await session.request('GET', '/api/remote-requests/$requestId') as Map<String, dynamic>;
    final status = data['status'];
    if (status == 'answered' && data['answer'] is String) return RequestAnswered(data['answer'] as String);
    final rejection = data['rejection'];
    if (status == 'rejected' && rejection is Map) {
      return RequestRejected(rejection['reason'] as String? ?? 'declined', (rejection['retryAfter'] as num?)?.toInt());
    }
    return const RequestPending();
  }

  /// Segundos de espera que acompañan a `too_many_requests` (o `locked`).
  static int? retryAfterOf(ApiError error) {
    final body = error.body;
    final errorBody = body is Map ? body['error'] : null;
    final details = errorBody is Map ? errorBody['details'] : null;
    final value = details is Map ? details['retryAfter'] : null;
    return value is num ? value.toInt() : null;
  }
}
