import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';

import '../api.dart';
import 'auth.dart';
import 'input.dart';
import 'protocol.dart';
import 'remote_api.dart';
import 'transfer.dart';

/// En qué punto está la sesión con el PC (como el visor de escritorio, D11).
enum ViewerPhase { idle, connecting, waiting, authenticating, connected, reconnecting, failed, closed }

/// Por dónde va la conexión, la latencia y las imágenes por segundo.
class ViewerStats {
  const ViewerStats({this.relay, this.rttMs, this.fps});

  /// null mientras no hay par de candidatos elegido.
  final bool? relay;
  final int? rttMs;
  final int? fps;
}

/// Fallo con el código que traduce la interfaz (los mismos que el escritorio).
class SessionFailure implements Exception {
  const SessionFailure(this.code, [this.retryAfter]);

  final String code;
  final int? retryAfter;

  @override
  String toString() => 'SessionFailure($code)';
}

/// Sesión del móvil con un PC (add-remote-desktop D3/D6/D9/D12), port de
/// `src/renderer/viewer/session.ts`: oferta completa (vanilla ICE) con transceptores recvonly y los
/// cuatro canales, publicada por la API; después responde al `hello` con la prueba de la contraseña.
/// K (nunca la contraseña) se queda en memoria mientras dure la pantalla, para reconectar sin
/// volver a pedirla.
class ViewerSession extends ChangeNotifier {
  ViewerSession(this.api, this.deviceId, {this.forceRelay = false});

  final RemoteApi api;
  final String deviceId;

  /// Solo candidatos de relé (TURN), para probar la conexión por relé.
  final bool forceRelay;

  static const _iceGatheringTimeout = Duration(seconds: 4);
  static const _pollInterval = Duration(seconds: 1);
  static const _pollTimeout = Duration(seconds: 60);

  /// Con confirmación local en el PC, la respuesta puede tardar 30 s.
  static const _authTimeout = Duration(seconds: 45);
  static const _disconnectedGrace = Duration(seconds: 5);
  static const reconnectWindow = Duration(seconds: 30);
  static const _reconnectPause = Duration(seconds: 2);

  /// Fallos que no se arreglan reintentando.
  static const finalErrors = {'wrong_password', 'locked', 'remote_disabled', 'missing_permissions', 'unsupported', 'declined', 'device_not_found'};

  final RTCVideoRenderer renderer = RTCVideoRenderer();

  ViewerPhase phase = ViewerPhase.idle;
  SessionFailure? failure;

  /// Por qué cerró el PC la sesión (`bye`).
  String? closedReason;
  String hostName = '';
  List<DisplayInfo> displays = const [];
  String? currentDisplay;
  FeaturesMessage features = const FeaturesMessage(clipboard: false, files: false, audio: false);
  ViewerStats stats = const ViewerStats();
  bool audioMuted = false;

  /// Trozo del portapapeles del PC.
  void Function(ClipboardPiece piece)? onClipboard;

  /// Canal de ficheros de la conexión en marcha, o null cuando se cierra.
  void Function(RTCDataChannel? channel)? onFileChannel;

  Uint8List? _key;
  RTCPeerConnection? _pc;
  RTCDataChannel? _control;
  RTCDataChannel? _input;
  RTCDataChannel? _pointer;
  RTCDataChannel? _file;
  MediaStream? _audioStream;
  Timer? _statsTimer;
  Timer? _disconnectedTimer;
  bool _closed = false;
  bool _recovering = false;
  bool _disposed = false;
  bool _rendererReady = false;
  ({double at, int frames})? _framesDecoded;

  bool get hasKey => _key != null;

  bool get connected => _control?.state == RTCDataChannelState.RTCDataChannelOpen && phase == ViewerPhase.connected;

  /// Conecta con la contraseña (primera vez) o con K (reconectar).
  Future<void> connect([String? password]) async {
    _closed = false;
    failure = null;
    closedReason = null;
    _setPhase(ViewerPhase.connecting);
    try {
      await _attempt(password);
      _setPhase(ViewerPhase.connected);
    } on Object catch (error) {
      final f = _failureOf(error);
      if (f.code == 'wrong_password') _key = null;
      await _teardown();
      failure = f;
      _setPhase(ViewerPhase.failed);
    }
  }

  /// Al volver a la app: si la conexión cayó mientras estaba en segundo plano (iOS suspende la
  /// app), se recupera con K sin pedir la contraseña.
  Future<void> recoverIfLost() async {
    if (_closed || _recovering || _key == null) return;
    final state = _pc?.connectionState;
    final lost = _pc == null ||
        state == RTCPeerConnectionState.RTCPeerConnectionStateFailed ||
        state == RTCPeerConnectionState.RTCPeerConnectionStateClosed ||
        state == RTCPeerConnectionState.RTCPeerConnectionStateDisconnected ||
        _control?.state != RTCDataChannelState.RTCDataChannelOpen;
    if (lost && (phase == ViewerPhase.connected || phase == ViewerPhase.reconnecting)) await _lost(_pc);
  }

  void sendInput(String message) {
    final channel = _input;
    if (channel?.state == RTCDataChannelState.RTCDataChannelOpen) unawaited(channel!.send(RTCDataChannelMessage(message)));
  }

  void sendInputs(Iterable<String> messages) => messages.forEach(sendInput);

  /// Posición normalizada (0–1) sobre la pantalla elegida; solo importa la última.
  void sendPointer(double x, double y) {
    final channel = _pointer;
    if (channel?.state == RTCDataChannelState.RTCDataChannelOpen) unawaited(channel!.send(RTCDataChannelMessage(RemoteInput.move(x, y))));
  }

  void sendControl(String message) {
    final channel = _control;
    if (channel?.state == RTCDataChannelState.RTCDataChannelOpen) unawaited(channel!.send(RTCDataChannelMessage(message)));
  }

  /// Espacio libre en el canal `control` (el portapapeles va en trozos por él).
  Future<bool> controlRoom() async {
    final channel = _control;
    if (channel == null) return false;
    while (channel.state == RTCDataChannelState.RTCDataChannelOpen && await channel.getBufferedAmount() > TransferLimits.bufferHighBytes) {
      await Future<void>.delayed(const Duration(milliseconds: 20));
    }
    return channel.state == RTCDataChannelState.RTCDataChannelOpen;
  }

  void selectDisplay(String id) {
    currentDisplay = id;
    sendControl(selectDisplayMessage(id));
    notifyListeners();
  }

  void setAudioMuted(bool muted) {
    audioMuted = muted;
    for (final track in _audioStream?.getAudioTracks() ?? const <MediaStreamTrack>[]) {
      track.enabled = !muted;
    }
    notifyListeners();
  }

  /// Cierra la sesión (Desconectar o salir de la pantalla): se despide del PC.
  Future<void> close() async {
    if (_closed && _pc == null) return;
    _closed = true;
    sendInput(RemoteInput.releaseAll());
    sendControl(byeMessage());
    await Future<void>.delayed(const Duration(milliseconds: 200));
    await _teardown();
    if (phase != ViewerPhase.failed) _setPhase(ViewerPhase.closed);
  }

  @override
  Future<void> dispose() async {
    _disposed = true;
    await close();
    if (_rendererReady) await renderer.dispose();
    super.dispose();
  }

  // --- Negociación ------------------------------------------------------------------

  void _progress(ViewerPhase value) {
    if (!_recovering) _setPhase(value);
  }

  Future<void> _attempt(String? password) async {
    await _teardown();
    if (!_rendererReady) {
      await renderer.initialize();
      _rendererReady = true;
    }
    // Solo se reproduce el sonido del PC: sin micrófono, y como multimedia (no como llamada)
    if (Platform.isIOS) {
      await Helper.setAppleAudioIOMode(AppleAudioIOMode.remoteOnly);
    } else if (Platform.isAndroid) {
      await Helper.setAndroidAudioConfiguration(AndroidAudioConfiguration.media);
    }
    final pc = await createPeerConnection({
      'iceServers': await api.iceServers(),
      'sdpSemantics': 'unified-plan',
      if (forceRelay) 'iceTransportPolicy': 'relay',
    });
    _pc = pc;
    await pc.addTransceiver(kind: RTCRtpMediaType.RTCRtpMediaTypeVideo, init: RTCRtpTransceiverInit(direction: TransceiverDirection.RecvOnly));
    await pc.addTransceiver(kind: RTCRtpMediaType.RTCRtpMediaTypeAudio, init: RTCRtpTransceiverInit(direction: TransceiverDirection.RecvOnly));
    final control = await pc.createDataChannel(Channels.control, RTCDataChannelInit());
    _control = control;
    _input = await pc.createDataChannel(Channels.input, RTCDataChannelInit());
    // Solo importa la última posición: sin orden y sin reenvíos tardíos (D9). flutter_webrtc no
    // envía maxRetransmits = 0, así que se limita la vida de cada mensaje
    _pointer = await pc.createDataChannel(Channels.pointer, RTCDataChannelInit()
      ..ordered = false
      ..maxRetransmitTime = 150);
    _file = await pc.createDataChannel(Channels.file, RTCDataChannelInit()..binaryType = 'binary');
    pc.onTrack = (event) {
      final stream = event.streams.isNotEmpty ? event.streams.first : null;
      if (event.track.kind == 'video') {
        if (stream != null) renderer.srcObject = stream;
      } else if (stream != null) {
        _audioStream = stream;
        event.track.enabled = !audioMuted;
      }
    };

    final gathered = Completer<void>();
    pc.onIceGatheringState = (state) {
      if (state == RTCIceGatheringState.RTCIceGatheringStateComplete && !gathered.isCompleted) gathered.complete();
    };
    await pc.setLocalDescription(await pc.createOffer());
    await gathered.future.timeout(_iceGatheringTimeout, onTimeout: () {});
    final offer = (await pc.getLocalDescription())!.sdp!;

    final String requestId;
    try {
      requestId = await api.createRequest(deviceId, offer);
    } on ApiError catch (error) {
      throw SessionFailure(error.code, RemoteApi.retryAfterOf(error));
    }
    _progress(ViewerPhase.waiting);
    final answer = await _waitForAnswer(requestId);
    await pc.setRemoteDescription(RTCSessionDescription(answer, 'answer'));
    _progress(ViewerPhase.authenticating);
    await _authenticate(pc, control, offer, answer, password);
    _watch(pc, control);
    onFileChannel?.call(_file);
  }

  Future<String> _waitForAnswer(String requestId) async {
    final deadline = DateTime.now().add(_pollTimeout);
    while (DateTime.now().isBefore(deadline)) {
      await Future<void>.delayed(_pollInterval);
      if (_closed) throw const SessionFailure('closed');
      final RequestStatus status;
      try {
        status = await api.poll(requestId);
      } on ApiError catch (error) {
        throw SessionFailure(error.code == 'remote_request_expired' ? 'no_answer' : error.code);
      }
      switch (status) {
        case RequestAnswered(:final answer):
          return answer;
        case RequestRejected(:final reason, :final retryAfter):
          throw SessionFailure(reason, retryAfter);
        case RequestPending():
          break;
      }
    }
    throw const SessionFailure('no_answer');
  }

  /// `hello` → prueba con K → `auth-result`. Lo posterior lo atiende [_watch].
  Future<void> _authenticate(RTCPeerConnection pc, RTCDataChannel control, String offer, String answer, String? password) {
    final done = Completer<void>();
    void fail(String code, [int? retryAfter]) {
      if (!done.isCompleted) done.completeError(SessionFailure(code, retryAfter));
    }

    pc.onConnectionState = (state) {
      if (state == RTCPeerConnectionState.RTCPeerConnectionStateFailed) fail('connection_failed');
    };
    control.onDataChannelState = (state) {
      if (state == RTCDataChannelState.RTCDataChannelClosed) fail('connection_failed');
    };
    control.onMessage = (message) async {
      if (message.isBinary) return;
      switch (parseHostMessage(message.text)) {
        case HelloMessage(:final salt, :final iterations, :final nonce, :final hostName):
          try {
            this.hostName = hostName;
            if (_key == null) {
              if (password == null) return fail('wrong_password');
              _key = await deriveKey(password, salt, iterations);
            }
            final proof = computeProof(_key!,
                nonce: nonce, offerFingerprint: sdpFingerprint(offer) ?? '', answerFingerprint: sdpFingerprint(answer) ?? '');
            await control.send(RTCDataChannelMessage(authMessage(proof)));
          } on Object {
            fail('connection_failed');
          }
        case AuthResultMessage(:final ok, :final reason, :final retryAfter):
          if (ok) {
            if (!done.isCompleted) done.complete();
          } else {
            fail(reason ?? 'connection_failed', retryAfter);
          }
        case ByeMessage(:final reason):
          fail(reason == 'wrong_password' ? 'wrong_password' : 'connection_failed');
        // Lo que llega a la vez que la autenticación (pantallas, funciones) se atiende igual
        case final HostMessage other:
          _handle(other);
        case null:
          break;
      }
    };
    return done.future.timeout(_authTimeout, onTimeout: () => throw const SessionFailure('connection_failed'));
  }

  /// Con la sesión en marcha: mensajes del PC, caídas de la red y estadísticas.
  void _watch(RTCPeerConnection pc, RTCDataChannel control) {
    control.onMessage = (message) {
      if (message.isBinary) return;
      final parsed = parseHostMessage(message.text);
      if (parsed != null) _handle(parsed);
    };
    control.onDataChannelState = (state) {
      if (state == RTCDataChannelState.RTCDataChannelClosed) unawaited(_lost(pc));
    };
    pc.onConnectionState = (state) {
      switch (state) {
        case RTCPeerConnectionState.RTCPeerConnectionStateFailed:
          unawaited(_lost(pc));
        case RTCPeerConnectionState.RTCPeerConnectionStateDisconnected:
          _disconnectedTimer ??= Timer(_disconnectedGrace, () => _lost(pc));
        case RTCPeerConnectionState.RTCPeerConnectionStateConnected:
          _disconnectedTimer?.cancel();
          _disconnectedTimer = null;
        default:
          break;
      }
    };
    _statsTimer = Timer.periodic(const Duration(seconds: 1), (_) => _collectStats(pc));
  }

  void _handle(HostMessage message) {
    switch (message) {
      case DisplaysMessage(:final displays, :final current):
        this.displays = displays;
        currentDisplay = current;
        notifyListeners();
      case FeaturesMessage():
        features = message;
        notifyListeners();
      case ClipboardMessage(:final piece):
        onClipboard?.call(piece);
      case ByeMessage(:final reason):
        // El PC cerró la sesión a propósito: no se reconecta solo. Con la contraseña nueva, K ya
        // no vale (reconectar con ella sería un intento fallido más)
        _closed = true;
        if (reason == 'password_changed') _key = null;
        closedReason = reason;
        unawaited(_teardown());
        _setPhase(ViewerPhase.closed);
      default:
        break;
    }
  }

  /// Se perdió la conexión: se repite la negociación con K durante 30 s, sin pedir la contraseña.
  Future<void> _lost(RTCPeerConnection? pc) async {
    if (_closed || _recovering || pc != _pc) return;
    _recovering = true;
    await _teardown();
    _setPhase(ViewerPhase.reconnecting);
    final deadline = DateTime.now().add(reconnectWindow);
    var last = const SessionFailure('reconnect_failed');
    while (!_closed && DateTime.now().isBefore(deadline)) {
      try {
        await _attempt(null);
        _recovering = false;
        _setPhase(ViewerPhase.connected);
        return;
      } on Object catch (error) {
        last = _failureOf(error);
        await _teardown();
        if (finalErrors.contains(last.code)) break;
        await Future<void>.delayed(_reconnectPause);
      }
    }
    _recovering = false;
    if (_closed) return;
    if (last.code == 'wrong_password') _key = null;
    failure = SessionFailure(finalErrors.contains(last.code) ? last.code : 'reconnect_failed', last.retryAfter);
    _setPhase(ViewerPhase.failed);
  }

  Future<void> _collectStats(RTCPeerConnection pc) async {
    if (pc != _pc) return;
    final List<StatsReport> reports;
    try {
      reports = await pc.getStats();
    } on Object {
      return;
    }
    final byId = {for (final r in reports) r.id: r};
    StatsReport? pair;
    int? fps;
    for (final r in reports) {
      if (r.type == 'transport' && r.values['selectedCandidatePairId'] is String) pair = byId[r.values['selectedCandidatePairId']];
      if (r.type == 'inbound-rtp' && (r.values['kind'] ?? r.values['mediaType']) == 'video') {
        final perSecond = r.values['framesPerSecond'];
        final decoded = r.values['framesDecoded'];
        if (perSecond is num) {
          fps = perSecond.round();
        } else if (decoded is num) {
          final previous = _framesDecoded;
          if (previous != null && r.timestamp > previous.at) fps = ((decoded - previous.frames) * 1000 / (r.timestamp - previous.at)).round();
          _framesDecoded = (at: r.timestamp, frames: decoded.toInt());
        }
      }
    }
    // Sin `transport` (algunas versiones): el par nominado que funciona
    pair ??= reports.where((r) => r.type == 'candidate-pair' && r.values['state'] == 'succeeded' && r.values['nominated'] == true).firstOrNull;
    final local = pair == null ? null : byId[pair.values['localCandidateId']];
    final remote = pair == null ? null : byId[pair.values['remoteCandidateId']];
    // Un candidato aprendido a través del relé sale como `prflx`, pero con `relayProtocol`
    final relayed = local?.values['candidateType'] == 'relay' || remote?.values['candidateType'] == 'relay' || local?.values['relayProtocol'] is String;
    final rtt = pair?.values['currentRoundTripTime'];
    stats = ViewerStats(relay: pair == null ? null : relayed, rttMs: rtt is num ? (rtt * 1000).round() : null, fps: fps);
    if (!_disposed) notifyListeners();
  }

  Future<void> _teardown() async {
    _statsTimer?.cancel();
    _statsTimer = null;
    _disconnectedTimer?.cancel();
    _disconnectedTimer = null;
    _framesDecoded = null;
    final pc = _pc;
    _pc = null;
    _control = null;
    _input = null;
    _pointer = null;
    _audioStream = null;
    if (_file != null) {
      _file = null;
      onFileChannel?.call(null);
    }
    if (_rendererReady) renderer.srcObject = null;
    if (pc != null) {
      pc
        ..onConnectionState = null
        ..onTrack = null
        ..onIceGatheringState = null;
      try {
        await pc.close();
      } on Object {
        // ya cerrada
      }
    }
  }

  void _setPhase(ViewerPhase value) {
    phase = value;
    if (!_disposed) notifyListeners();
  }

  static SessionFailure _failureOf(Object error) => switch (error) {
        SessionFailure() => error,
        ApiError(:final code) => SessionFailure(code, RemoteApi.retryAfterOf(error)),
        _ => const SessionFailure('connection_failed'),
      };
}
