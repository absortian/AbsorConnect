import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:crypto/crypto.dart' as crypto;
import 'package:flutter_webrtc/flutter_webrtc.dart';

import '../api.dart';
import 'auth.dart';
import 'agent_protocol.dart';
import 'agent_viewer_state.dart';
import 'input.dart';
import 'host_actions.dart';
import 'protocol.dart';
import 'quality_selection.dart';
import 'remote_api.dart';
import 'transfer.dart';
import 'video_stats.dart';
export 'video_stats.dart' show ViewerStats;

/// En qué punto está la sesión con el PC (como el visor de escritorio, D11).
enum ViewerPhase { idle, connecting, waiting, authenticating, connected, reconnecting, failed, closed }

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
  ViewerSession(this.api, this.deviceId, {this.forceRelay = false}) {
    _operations = HostActions(active: () => _authenticated && !_closed && !_disposed && _foreground && agentContext.enabled && agentContext.sequence > 0 && _control?.state == RTCDataChannelState.RTCDataChannelOpen, send: (operation) async {
      final channel = _control;
      if (channel == null || channel.state != RTCDataChannelState.RTCDataChannelOpen) throw const SessionFailure('closed');
      await channel.send(RTCDataChannelMessage(jsonEncode(operation.toJson())));
    });
    _operations.addListener(_operationsChanged);
    _owner = api.session.token;
    api.session.addListener(_accountChanged);
  }
  late final HostActions _operations;
  HostActions get operations => _operations;
  String? _owner;
  bool _foreground = true;
  void _operationsChanged() { if (!_disposed) notifyListeners(); }
  void _forgetKey() { _key?.fillRange(0, _key!.length, 0); _key = null; }
  void _accountChanged() { if (api.session.token != _owner) { _forgetKey(); unawaited(close()); } }
  void setForeground(bool value) {
    if (_foreground == value) return;
    if (!value) { _releaseInput(); operations.invalidateConfirmation(); }
    _foreground = value;
  }
  void releaseInput() => _releaseInput();
  Future<HostActionOutcome> performOperation(AgentAction action, Future<bool> Function() confirm) => operations.run(action, confirm);

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
  final _quality = QualitySelection();
  StreamProfile get streamProfile => _quality.confirmed;
  bool _authenticated = false;
  int _challengeCount = 0;
  String? _challengeId;
  /// Solo contador/hash del nonce público; no expone K, contraseña ni SDP.
  int get challengeCount => _challengeCount;
  String? get challengeId => _challengeId;
  AgentViewerState _agentState = AgentViewerState();
  FeaturesMessage _declaredFeatures = const FeaturesMessage(clipboard: false, files: false, audio: false);
  int _contextEpoch = 0;
  bool _frameCurrent = true;
  int? _contextFramesBaseline;
  AgentViewerStatus get agentContext => _agentState.status;
  int get contextEpoch => _contextEpoch;
  bool get contextImageCurrent => !agentContext.enabled || (_frameCurrent && agentContext.imageAvailable);
  bool get inputAllowed => _input?.state == RTCDataChannelState.RTCDataChannelOpen && _authenticated && _foreground && !_closed && !_disposed && !operations.state.confirming && operations.state.pending == null && agentContext.inputAllowed && contextImageCurrent && (!agentContext.enabled || (renderer.renderVideo && renderer.videoWidth > 0 && renderer.videoHeight > 0));
  void Function()? onContextBoundary;

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
  final List<MediaStreamTrack> _audioTracks = [];
  final Set<MediaStream> _ownedVideoStreams = {};
  Timer? _statsTimer;
  Timer? _disconnectedTimer;
  bool _closed = false;
  bool _recovering = false;
  bool _disposed = false;
  bool _rendererReady = false;
  Future<void>? _teardownPending;
  Future<void>? _connecting;
  Future<void>? _recoveringFuture;
  int _connectionEpoch = 0;
  final _statsSampler = VideoStatsSampler();
  final _statsPending = <RTCPeerConnection>{};

  bool get hasKey => _key != null;

  bool get connected => _control?.state == RTCDataChannelState.RTCDataChannelOpen && phase == ViewerPhase.connected;

  /// Conecta con la contraseña (primera vez) o con K (reconectar).
  Future<void> connect([String? password]) {
    if (_connecting != null || _recovering || _disposed || !_foreground || api.session.token != _owner) return Future.value();
    final epoch = ++_connectionEpoch;
    late final Future<void> current;
    current = _connectNow(password, epoch).whenComplete(() { if (identical(_connecting, current)) _connecting = null; });
    _connecting = current;
    return current;
  }
  Future<void> _connectNow(String? password, int epoch) async {
    _closed = false;
    failure = null;
    closedReason = null;
    _setPhase(ViewerPhase.connecting);
    try {
      await _attempt(password, epoch);
      _checkAttempt(epoch);
      _setPhase(ViewerPhase.connected);
    } on Object catch (error) {
      if (_closed || _disposed) { await _teardown(); return; }
      if (epoch != _connectionEpoch) return;
      final f = _failureOf(error);
      if (f.code == 'wrong_password') _forgetKey();
      await _teardown();
      if (epoch != _connectionEpoch || _closed || _disposed) return;
      failure = f;
      _setPhase(ViewerPhase.failed);
    }
  }
  void _checkAttempt(int epoch) {
    if (epoch != _connectionEpoch || _closed || _disposed || !_foreground || api.session.token != _owner) throw const SessionFailure('closed');
  }

  /// Al volver a la app: si la conexión cayó mientras estaba en segundo plano (iOS suspende la
  /// app), se recupera con K sin pedir la contraseña.
  Future<void> recoverIfLost() async {
    if (_closed || !_foreground || _recovering || _key == null) return;
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
    if (inputAllowed && channel?.state == RTCDataChannelState.RTCDataChannelOpen) unawaited(channel!.send(RTCDataChannelMessage(message)));
  }

  void sendInputs(Iterable<String> messages) => messages.forEach(sendInput);

  /// Posición normalizada (0–1) sobre la pantalla elegida; solo importa la última.
  void sendPointer(double x, double y) {
    final channel = _pointer;
    if (inputAllowed && channel?.state == RTCDataChannelState.RTCDataChannelOpen) unawaited(channel!.send(RTCDataChannelMessage(RemoteInput.move(x, y))));
  }

  void sendControl(String message) {
    final channel = _control;
    if (channel?.state == RTCDataChannelState.RTCDataChannelOpen) unawaited(channel!.send(RTCDataChannelMessage(message)));
  }

  /// Espacio libre en el canal `control` (el portapapeles va en trozos por él).
  Future<bool> controlRoom() async {
    final channel = _control;
    final epoch = _contextEpoch;
    bool current() => channel == _control && epoch == _contextEpoch && _authenticated && !_closed && agentContext.sensitiveAllowed;
    if (channel == null || !current()) return false;
    while (channel.state == RTCDataChannelState.RTCDataChannelOpen && await channel.getBufferedAmount() > TransferLimits.bufferHighBytes) {
      if (!current()) return false;
      await Future<void>.delayed(const Duration(milliseconds: 20));
    }
    return current() && channel.state == RTCDataChannelState.RTCDataChannelOpen;
  }

  void selectDisplay(String id) {
    currentDisplay = id;
    sendControl(selectDisplayMessage(id));
    notifyListeners();
  }

  void selectQuality(StreamProfile profile) {
    if (!features.streamQuality || !connected) return;
    final message = _quality.select(profile);
    if (message != null) sendControl(message);
  }

  void setAudioMuted(bool muted) {
    audioMuted = muted;
    for (final track in _audioTracks) {
      track.enabled = features.audio && !muted;
    }
    notifyListeners();
  }

  /// Cierra la sesión (Desconectar o salir de la pantalla): se despide del PC.
  Future<void> close() async {
    _connectionEpoch++;
    if (_closed && _pc == null) {
      await _teardownPending;
      return;
    }
    _releaseInput();
    final closingPc = _pc;
    _closed = true;
    _forgetKey();
    operations.invalidateConfirmation();
    sendControl(byeMessage());
    await Future<void>.delayed(const Duration(milliseconds: 200));
    if (_pc != closingPc) return;
    await _teardown();
    if (phase != ViewerPhase.failed) _setPhase(ViewerPhase.closed);
  }

  @override
  Future<void> dispose() async {
    _disposed = true;
    api.session.removeListener(_accountChanged);
    await close();
    // No liberar la textura mientras una inicialización cancelada aún puede usarla.
    await _connecting;
    await _recoveringFuture;
    await _teardown();
    _operations.removeListener(_operationsChanged);
    _operations.dispose();
    if (_rendererReady) await renderer.dispose();
    super.dispose();
  }

  // --- Negociación ------------------------------------------------------------------

  void _progress(ViewerPhase value) {
    if (!_recovering) _setPhase(value);
  }

  Future<void> _attempt(String? password, int epoch) async {
    _checkAttempt(epoch);
    // Antes de crear texturas/fábrica: los logs informativos nativos pueden incluir credenciales ICE.
    await WebRTC.initialize(options: {'logSeverity': 'error'});
    _checkAttempt(epoch);
    await _teardown();
    _checkAttempt(epoch);
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
    _checkAttempt(epoch);
    final ice = await api.iceServers();
    _checkAttempt(epoch);
    final pc = await createPeerConnection({
      'iceServers': ice,
      'sdpSemantics': 'unified-plan',
      if (forceRelay) 'iceTransportPolicy': 'relay',
    });
    try { _checkAttempt(epoch); } on Object {
      try { await pc.close(); } finally { await pc.dispose(); }
      rethrow;
    }
    _pc = pc;
    await pc.addTransceiver(kind: RTCRtpMediaType.RTCRtpMediaTypeVideo, init: RTCRtpTransceiverInit(direction: TransceiverDirection.RecvOnly));
    await pc.addTransceiver(kind: RTCRtpMediaType.RTCRtpMediaTypeAudio, init: RTCRtpTransceiverInit(direction: TransceiverDirection.RecvOnly));
    final control = await pc.createDataChannel(Channels.control, RTCDataChannelInit());
    _control = control;
    _input = await pc.createDataChannel(Channels.input, RTCDataChannelInit());
    _input!.onDataChannelState = (_) { if (pc == _pc && !_closed && !_disposed) notifyListeners(); };
    // Solo importa la última posición: sin orden y sin reenvíos tardíos (D9). flutter_webrtc no
    // envía maxRetransmits = 0, así que se limita la vida de cada mensaje
    _pointer = await pc.createDataChannel(Channels.pointer, RTCDataChannelInit()
      ..ordered = false
      ..maxRetransmitTime = 150);
    _file = await pc.createDataChannel(Channels.file, RTCDataChannelInit()..binaryType = 'binary');
    pc.onTrack = (event) async {
      if (event.track.kind == 'video') {
        // El PC pone sus pistas con replaceTrack en los transceptores de la oferta, sin
        // MediaStream: entonces se crea uno para el renderizador (como el visor de escritorio)
        var stream = event.streams.isNotEmpty ? event.streams.first : null;
        if (stream == null) {
          stream = await createLocalMediaStream('remote-video');
          if (pc != _pc || _closed || _disposed) {
            await stream.dispose();
            return;
          }
          _ownedVideoStreams.add(stream);
          await stream.addTrack(event.track);
        }
        if (pc == _pc && !_closed && !_disposed) {
          // Unified Plan puede reemplazar el wrapper: seleccionar la pista del PC actual.
          await renderer.setSrcObject(stream: stream, trackId: event.track.id);
        }
      } else {
        // El sonido remoto suena solo; la pista se guarda para silenciarlo
        if (pc != _pc || _closed || _disposed) return;
        _audioTracks.add(event.track);
        event.track.enabled = features.audio && !audioMuted;
      }
    };

    final gathered = Completer<void>();
    pc.onIceGatheringState = (state) {
      if (state == RTCIceGatheringState.RTCIceGatheringStateComplete && !gathered.isCompleted) gathered.complete();
    };
    await pc.setLocalDescription(await pc.createOffer());
    await gathered.future.timeout(_iceGatheringTimeout, onTimeout: () {});
    _checkAttempt(epoch);
    final offer = (await pc.getLocalDescription())!.sdp!;
    _checkAttempt(epoch);

    final String requestId;
    try {
      requestId = await api.createRequest(deviceId, offer);
    } on ApiError catch (error) {
      throw SessionFailure(error.code, RemoteApi.retryAfterOf(error));
    }
    _checkAttempt(epoch);
    _progress(ViewerPhase.waiting);
    final answer = await _waitForAnswer(requestId);
    _checkAttempt(epoch);
    await pc.setRemoteDescription(RTCSessionDescription(answer, 'answer'));
    _checkAttempt(epoch);
    _progress(ViewerPhase.authenticating);
    await _authenticate(pc, control, offer, answer, password);
    _checkAttempt(epoch);
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
      if (pc != _pc || _closed || _disposed) return;
      if (message.isBinary) return;
      if (_handleAgent(message.text)) return;
      switch (parseHostMessage(message.text)) {
        case HelloMessage(:final salt, :final iterations, :final nonce, :final hostName):
          if (++_challengeCount != 1) return fail('connection_failed');
          _challengeId = crypto.sha256.convert(utf8.encode(nonce)).toString();
          try {
            this.hostName = hostName;
            if (_key == null) {
              if (password == null) return fail('wrong_password');
              final derived = await deriveKey(password, salt, iterations);
              if (pc != _pc || _closed || _disposed) { derived.fillRange(0, derived.length, 0); return fail('closed'); }
              _key = derived;
            }
            final proof = computeProof(_key!,
                nonce: nonce, offerFingerprint: sdpFingerprint(offer) ?? '', answerFingerprint: sdpFingerprint(answer) ?? '');
            await control.send(RTCDataChannelMessage(authMessage(proof)));
          } on Object {
            fail('connection_failed');
          }
        case AuthResultMessage(:final ok, :final reason, :final retryAfter):
          if (ok && pc == _pc && !_closed) {
            _authenticated = true;
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
      if (pc != _pc || _closed) return;
      if (message.isBinary) return;
      if (_handleAgent(message.text)) return;
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
    if (!_authenticated || _closed || _disposed) return;
    switch (message) {
      case DisplaysMessage(:final displays, :final current):
        this.displays = displays;
        currentDisplay = current;
        notifyListeners();
      case FeaturesMessage():
        _declaredFeatures = message;
        final previous = agentContext;
        if (_agentState.announce(1, message.unattendedControl)) {
          _applyAgentState(previous);
          sendControl(jsonEncode(const AgentControlEnable().toJson()));
        } else {
          _publishFeatures();
        }
        final request = _quality.negotiate(message.streamQuality);
        if (request != null) sendControl(request);
        notifyListeners();
      case StreamQualityMessage(:final profile):
        if (features.streamQuality) {
          _quality.confirm(profile);
          notifyListeners();
        }
      case ClipboardMessage(:final piece):
        if (agentContext.sensitiveAllowed && features.clipboard) onClipboard?.call(piece);
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
  Future<void> _lost(RTCPeerConnection? pc) {
    if (_recoveringFuture != null) return _recoveringFuture!;
    late final Future<void> current;
    current = _recover(pc).whenComplete(() { if (identical(_recoveringFuture, current)) _recoveringFuture = null; });
    _recoveringFuture = current;
    return current;
  }
  Future<void> _recover(RTCPeerConnection? pc) async {
    if (_closed || !_foreground || _recovering || pc != _pc) return;
    _recovering = true;
    final epoch = ++_connectionEpoch;
    await _teardown();
    if (epoch != _connectionEpoch || _closed || _disposed || !_foreground) { _recovering = false; return; }
    _setPhase(ViewerPhase.reconnecting);
    final deadline = DateTime.now().add(reconnectWindow);
    var last = const SessionFailure('reconnect_failed');
    while (!_closed && _foreground && DateTime.now().isBefore(deadline)) {
      try {
        await _attempt(null, epoch);
        _checkAttempt(epoch);
        _recovering = false;
        _setPhase(ViewerPhase.connected);
        return;
      } on Object catch (error) {
        if (epoch != _connectionEpoch || _closed || _disposed || !_foreground) { if (_closed || _disposed) await _teardown(); _recovering = false; return; }
        last = _failureOf(error);
        await _teardown();
        if (finalErrors.contains(last.code)) break;
        await Future<void>.delayed(_reconnectPause);
      }
    }
    _recovering = false;
    if (_closed) return;
    if (last.code == 'wrong_password') _forgetKey();
    failure = SessionFailure(finalErrors.contains(last.code) ? last.code : 'reconnect_failed', last.retryAfter);
    _setPhase(ViewerPhase.failed);
  }

  Future<void> _collectStats(RTCPeerConnection pc) async {
    if (pc != _pc || _closed || _disposed || !_statsPending.add(pc)) return;
    final epoch = _contextEpoch;
    try {
      final reports = await pc.getStats();
      if (pc != _pc || _closed || _disposed) return;
      stats = _statsSampler.sample(reports);
      if (epoch == _contextEpoch && agentContext.enabled && agentContext.imageAvailable && !_frameCurrent) {
        final frames = stats.decodedFrames;
        if (frames != null) {
          if (_contextFramesBaseline == null) { _contextFramesBaseline = frames; }
          else if (frames > _contextFramesBaseline!) { _frameCurrent = true; }
        }
      }
      notifyListeners();
    } on Object {
      if (pc == _pc && !_closed && !_disposed) {
        _statsSampler.reset();
        stats = const ViewerStats();
        notifyListeners();
      }
    } finally {
      _statsPending.remove(pc);
    }
  }

  bool _handleAgent(String raw) {
    if (!_authenticated || _closed || _disposed) return false;
    final message = parseAgentHostMessage(raw);
    if (message is HostOperationResult) {
      final matched = operations.receive(message);
      if (matched && message.status == HostOperationStatus.accepted && {AgentAction.restart, AgentAction.logout}.contains(message.action)) {
        _releaseInput();
        _forgetKey();
        _closed = true;
        // Cortar contenido sensible antes de que termine la solicitud asíncrona.
        _declaredFeatures = const FeaturesMessage(clipboard: false, files: false, audio: false);
        _publishFeatures();
        _contextEpoch++;
        onContextBoundary?.call();
        _setPhase(ViewerPhase.closed);
      }
      return true;
    }
    final previous = agentContext;
    if (!_agentState.accept(raw)) return false;
    _applyAgentState(previous);
    return true;
  }

  void _applyAgentState(AgentViewerStatus previous) {
    final next = agentContext;
    operations.invalidateConfirmation();
    operations.setActions(next.sequence > 0 ? _agentState.actions : const []);
    final boundary = next.enabled && (!previous.enabled || next.sequence != previous.sequence);
    _releaseInput();
    if (boundary || !next.imageAvailable) {
      _frameCurrent = false;
      _contextFramesBaseline = null;
    }
    if (boundary) {
      _contextEpoch++;
      onContextBoundary?.call();
    }
    _publishFeatures();
    if (!_disposed) notifyListeners();
    final pc = _pc;
    if (pc != null && next.imageAvailable && !_frameCurrent) unawaited(_collectStats(pc));
  }

  void _publishFeatures() {
    final sensitive = agentContext.sensitiveAllowed;
    features = FeaturesMessage(clipboard: sensitive && _declaredFeatures.clipboard, files: sensitive && _declaredFeatures.files, audio: sensitive && _declaredFeatures.audio, streamQuality: _declaredFeatures.streamQuality, unattendedControl: _declaredFeatures.unattendedControl);
    for (final track in _audioTracks) { track.enabled = features.audio && !audioMuted; }
  }

  void _releaseInput() {
    final channel = _input;
    if (_authenticated && channel?.state == RTCDataChannelState.RTCDataChannelOpen) {
      unawaited(channel!.send(RTCDataChannelMessage(RemoteInput.releaseAll())).catchError((Object _) {}));
    }
  }

  Future<void> _teardown() {
    final pending = _teardownPending;
    if (pending != null) return pending;
    late final Future<void> current;
    current = _teardownNow().whenComplete(() {
      if (identical(_teardownPending, current)) _teardownPending = null;
    });
    _teardownPending = current;
    return current;
  }

  Future<void> _teardownNow() async {
    _releaseInput();
    operations.reset();
    final wasAgent = agentContext.enabled;
    _agentState = AgentViewerState();
    _contextEpoch++;
    _frameCurrent = true;
    _contextFramesBaseline = null;
    if (wasAgent) onContextBoundary?.call();
    for (final track in _audioTracks) { track.enabled = false; }
    _declaredFeatures = const FeaturesMessage(clipboard: false, files: false, audio: false);
    _statsTimer?.cancel();
    _statsTimer = null;
    _disconnectedTimer?.cancel();
    _disconnectedTimer = null;
    _statsSampler.reset();
    _authenticated = false;
    _challengeCount = 0;
    _challengeId = null;
    _quality.reset();
    stats = const ViewerStats();
    features = const FeaturesMessage(clipboard: false, files: false, audio: false);
    final pc = _pc;
    _pc = null;
    _control = null;
    _input = null;
    _pointer = null;
    _audioTracks.clear();
    if (_file != null) {
      _file = null;
      onFileChannel?.call(null);
    }
    if (_rendererReady) {
      try { await renderer.setSrcObject(stream: null); } on Object {
        // Un fallo de textura no puede impedir cerrar y liberar el transporte nativo.
      }
    }
    final streams = _ownedVideoStreams.toList();
    _ownedVideoStreams.clear();
    for (final stream in streams) {
      try {
        await stream.dispose();
      } on Object {
        // Puede haber desaparecido al cerrar la conexión nativa.
      }
    }
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
      try {
        await pc.dispose();
      } on Object {
        // Liberar el registro nativo aunque close haya fallado.
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
