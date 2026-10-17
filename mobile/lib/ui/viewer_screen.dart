import 'dart:async';
import 'dart:math' as math;

import 'package:file_picker/file_picker.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:share_plus/share_plus.dart';

import '../l10n/app_localizations.dart';
import '../src/remote/input.dart';
import '../src/remote/remote_api.dart';
import '../src/remote/remote_transfers.dart';
import '../src/remote/viewer_session.dart';
import 'devices_screen.dart';
import 'remote_texts.dart';
import 'theme.dart';

/// Sesión con un PC a pantalla completa, en vertical y en horizontal (mobile-app, D12).
class ViewerScreen extends StatefulWidget {
  const ViewerScreen({super.key, required this.api, required this.device, required this.password});

  final RemoteApi api;
  final RemoteDevice device;
  final String password;

  @override
  State<ViewerScreen> createState() => _ViewerScreenState();
}

class _ViewerScreenState extends State<ViewerScreen> with WidgetsBindingObserver {
  /// En segundo plano, la sesión aguanta 30 s; después se cierra (mobile-app).
  static const _backgroundLimit = Duration(seconds: 30);

  late final ViewerSession _session;

  /// Se crea antes de conectar: la sesión le pasa el canal de ficheros al autenticarse.
  late final RemoteTransfers _transfers;
  final _keyboardFocus = FocusNode();
  bool _mouseMode = true;
  bool _keyboard = false;
  bool _toolbar = true;
  bool _closedInBackground = false;
  Timer? _backgroundTimer;
  final Set<String> _modifiers = {};

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
    _session = ViewerSession(widget.api, widget.device.id);
    _transfers = RemoteTransfers(_session);
    unawaited(_session.connect(widget.password));
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _backgroundTimer?.cancel();
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
    _keyboardFocus.dispose();
    _transfers.dispose();
    unawaited(_session.dispose());
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused || state == AppLifecycleState.hidden) {
      _backgroundTimer ??= Timer(_backgroundLimit, () {
        _closedInBackground = true;
        unawaited(_session.close());
      });
    } else if (state == AppLifecycleState.resumed) {
      _backgroundTimer?.cancel();
      _backgroundTimer = null;
      if (!_closedInBackground) unawaited(_session.recoverIfLost());
    }
  }

  Future<void> _reconnect() async {
    _closedInBackground = false;
    if (_session.hasKey) return _session.connect();
    final password = await askPcPassword(context, widget.device.name);
    if (password != null) await _session.connect(password);
  }

  Future<void> _disconnect() async {
    await _session.close();
    if (mounted) Navigator.of(context).pop();
  }

  // --- Teclado ------------------------------------------------------------------------

  void _toggleKeyboard() {
    setState(() => _keyboard = !_keyboard);
    if (_keyboard) {
      _keyboardFocus.requestFocus();
    } else {
      _keyboardFocus.unfocus();
    }
  }

  void _toggleModifier(String code) => setState(() => _modifiers.contains(code) ? _modifiers.remove(code) : _modifiers.add(code));

  /// Una tecla de la barra, con los modificadores de un toque que estén activos.
  void _pressKey(String code) {
    _session.sendInputs(RemoteInput.combo([..._modifiers, code]));
    if (_modifiers.isNotEmpty) setState(_modifiers.clear);
  }

  /// Lo escrito con el teclado del teléfono. Con un modificador activo y una tecla propia, va como
  /// combinación (Ctrl + "c" es Ctrl+C); si no, como texto, que el PC escribe tal cual ("Mañana").
  void _typed(String text) {
    if (_modifiers.isNotEmpty && text.length == 1) {
      final code = RemoteKeys.codeFor(text);
      if (code != null) return _pressKey(code);
    }
    _session.sendInputs(RemoteInput.text(text));
    if (_modifiers.isNotEmpty) setState(_modifiers.clear);
  }

  // --- Ficheros, portapapeles y pantallas ---------------------------------------------

  Future<void> _sendClipboard() async {
    final t = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final sent = await _transfers.sendClipboard();
    messenger.showSnackBar(SnackBar(content: Text(sent ? t.remoteClipboardSent : t.remoteClipboardEmpty)));
  }

  Future<void> _sendFiles({required bool photos}) async {
    final picked = await FilePicker.pickFiles(type: photos ? FileType.media : FileType.any);
    if (picked.isEmpty) return;
    final files = [for (final f in picked) (name: f.name, size: await f.length() ?? 0, open: f.readAsByteStream)];
    if (!mounted) return;
    _transfers.upload(files);
    _showTransfers();
  }

  Future<void> _download() async {
    final picked = await showModalBottomSheet<({String path, String name, int size})>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => _RemoteBrowser(transfers: _transfers),
    );
    if (picked == null || !mounted) return;
    final transfer = await _transfers.download(picked.path, picked.name, picked.size);
    if (transfer.status == RemoteTransferStatus.done && transfer.result != null) {
      await SharePlus.instance.share(ShareParams(files: [XFile(transfer.result!)]));
    } else if (mounted) {
      _showTransfers();
    }
  }

  void _showTransfers() => showModalBottomSheet<void>(context: context, useSafeArea: true, builder: (_) => _TransfersSheet(transfers: _transfers));

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    return PopScope(
      onPopInvokedWithResult: (didPop, _) {
        if (didPop) unawaited(_session.close());
      },
      child: Scaffold(
        backgroundColor: Colors.black,
        resizeToAvoidBottomInset: true,
        body: ListenableBuilder(
          listenable: _session,
          builder: (context, _) {
            final connected = _session.phase == ViewerPhase.connected;
            return Stack(children: [
              Positioned.fill(
                child: Column(children: [
                  Expanded(
                    child: _RemoteView(session: _session, mouseMode: _mouseMode, enabled: connected),
                  ),
                  if (_keyboard && connected)
                    _KeyBar(
                      modifiers: _modifiers,
                      systemKey: widget.device.platform == 'macos' ? 'Cmd' : 'Win',
                      onModifier: _toggleModifier,
                      onKey: _pressKey,
                    ),
                ]),
              ),
              // Campo invisible que recibe el teclado del teléfono
              Positioned(left: 0, bottom: 0, width: 1, height: 1, child: _HiddenInput(focusNode: _keyboardFocus, onText: _typed, onKey: _pressKey)),
              if (connected)
                Positioned(
                  top: 0,
                  left: 0,
                  right: 0,
                  child: SafeArea(
                    bottom: false,
                    child: _Toolbar(
                      expanded: _toolbar,
                      onExpanded: (value) => setState(() => _toolbar = value),
                      session: _session,
                      mouseMode: _mouseMode,
                      keyboard: _keyboard,
                      onMode: () => setState(() => _mouseMode = !_mouseMode),
                      onKeyboard: _toggleKeyboard,
                      onClipboard: _sendClipboard,
                      onSendFile: () => _sendFiles(photos: false),
                      onSendPhoto: () => _sendFiles(photos: true),
                      onDownload: _download,
                      onTransfers: _transfers.transfers.isEmpty ? null : _showTransfers,
                      onDisconnect: _disconnect,
                    ),
                  ),
                ),
              if (!connected)
                Positioned.fill(
                  child: _StatusOverlay(
                    session: _session,
                    pcName: widget.device.name,
                    closedInBackground: _closedInBackground,
                    onReconnect: _reconnect,
                    onBack: () => Navigator.of(context).pop(),
                    backLabel: t.remoteBack,
                  ),
                ),
            ]);
          },
        ),
      ),
    );
  }
}

/// La imagen del PC y los gestos (D12).
///   - Modo ratón (trackpad): un dedo mueve el puntero, tocar es clic, dos dedos a la vez son clic
///     derecho, y mantener pulsado y mover arrastra.
///   - Modo táctil: tocar hace clic donde se toca, mantener pulsado es clic derecho y arrastrar con
///     un dedo arrastra.
///   - En los dos: dos dedos desplazan (rueda) y el pellizco hace zoom en el móvil.
class _RemoteView extends StatefulWidget {
  const _RemoteView({required this.session, required this.mouseMode, required this.enabled});

  final ViewerSession session;
  final bool mouseMode;
  final bool enabled;

  @override
  State<_RemoteView> createState() => _RemoteViewState();
}

enum _TwoFingers { undecided, scroll, zoom }

class _RemoteViewState extends State<_RemoteView> {
  /// Puntero en coordenadas normalizadas (modo ratón).
  Offset _cursor = const Offset(0.5, 0.5);
  double _zoom = 1;
  Offset _pan = Offset.zero;
  Size _box = Size.zero;

  // Gesto en curso
  int _pointers = 0;
  int _maxPointers = 0;
  DateTime _downAt = DateTime.now();
  double _travel = 0;
  bool _dragging = false;
  _TwoFingers _two = _TwoFingers.undecided;
  double _startZoom = 1;
  Offset _lastFocal = Offset.zero;
  double _scrollRemainder = 0;

  ViewerSession get _session => widget.session;

  /// Rectángulo de la imagen dentro de la caja (ajustada sin recortar), antes del zoom local.
  Rect _imageRect() {
    final value = _session.renderer.value;
    final vw = value.width, vh = value.height;
    if (vw <= 0 || vh <= 0 || _box.isEmpty) return Offset.zero & _box;
    final scale = math.min(_box.width / vw, _box.height / vh);
    final size = Size(vw * scale, vh * scale);
    return Offset((_box.width - size.width) / 2, (_box.height - size.height) / 2) & size;
  }

  /// Punto de la pantalla → posición normalizada en el PC.
  Offset _normalized(Offset screen) {
    final content = (screen - _pan) / _zoom;
    final rect = _imageRect();
    return Offset(((content.dx - rect.left) / rect.width).clamp(0.0, 1.0), ((content.dy - rect.top) / rect.height).clamp(0.0, 1.0));
  }

  /// Posición normalizada → punto de la pantalla (para dibujar el puntero).
  Offset _toScreen(Offset normalized) {
    final rect = _imageRect();
    return Offset(rect.left + normalized.dx * rect.width, rect.top + normalized.dy * rect.height) * _zoom + _pan;
  }

  void _moveTo(Offset normalized, {bool reliable = false}) {
    _session.sendPointer(normalized.dx, normalized.dy);
    // La posición de cada clic va también por el canal fiable, en orden con los botones (D9)
    if (reliable) _session.sendInput(RemoteInput.move(normalized.dx, normalized.dy));
  }

  void _click(Offset normalized, {int button = 0}) {
    _moveTo(normalized, reliable: true);
    _session.sendInputs([RemoteInput.button(button, down: true), RemoteInput.button(button, down: false)]);
  }

  void _clampPan() {
    if (_zoom <= 1) {
      _pan = Offset.zero;
      return;
    }
    _pan = Offset(_pan.dx.clamp(_box.width - _box.width * _zoom, 0.0), _pan.dy.clamp(_box.height - _box.height * _zoom, 0.0));
  }

  // --- Toques -------------------------------------------------------------------------

  void _onPointerDown(PointerDownEvent event) {
    if (_pointers == 0) {
      _maxPointers = 0;
      _travel = 0;
      _downAt = DateTime.now();
    }
    _pointers++;
    _maxPointers = math.max(_maxPointers, _pointers);
  }

  void _onPointerMove(PointerMoveEvent event) => _travel += event.delta.distance;

  void _onPointerUp(PointerEvent event) {
    _pointers = math.max(0, _pointers - 1);
    // Dos dedos que tocan y se levantan sin moverse: clic derecho (en el puntero, o entre los dedos)
    if (_pointers == 0 && _maxPointers == 2 && _travel < 24 && DateTime.now().difference(_downAt) < const Duration(milliseconds: 350)) {
      _click(widget.mouseMode ? _cursor : _normalized(event.localPosition), button: 2);
    }
  }

  void _onTapUp(TapUpDetails details) {
    // Con dos dedos el primero también cuenta como toque: ese gesto es solo el clic derecho
    if (_maxPointers > 1) return;
    if (widget.mouseMode) {
      _click(_cursor);
    } else {
      _click(_normalized(details.localPosition));
    }
  }

  void _onLongPressStart(LongPressStartDetails details) {
    if (widget.mouseMode) {
      // Mantener pulsado y mover: arrastrar desde el puntero
      _dragging = true;
      _moveTo(_cursor, reliable: true);
      _session.sendInput(RemoteInput.button(0, down: true));
    } else {
      _click(_normalized(details.localPosition), button: 2);
    }
  }

  void _onLongPressMove(LongPressMoveUpdateDetails details) {
    if (!widget.mouseMode || !_dragging) return;
    _moveCursorBy(details.offsetFromOrigin - _lastLongPressOffset);
    _lastLongPressOffset = details.offsetFromOrigin;
  }

  Offset _lastLongPressOffset = Offset.zero;

  void _onLongPressEnd(LongPressEndDetails details) {
    _lastLongPressOffset = Offset.zero;
    if (!_dragging) return;
    _dragging = false;
    _moveTo(_cursor, reliable: true);
    _session.sendInput(RemoteInput.button(0, down: false));
  }

  void _moveCursorBy(Offset delta) {
    final rect = _imageRect();
    if (rect.isEmpty) return;
    // Un poco más rápido que el dedo, como un trackpad
    const speed = 1.4;
    setState(() {
      _cursor = Offset(
        (_cursor.dx + delta.dx * speed / (rect.width * _zoom)).clamp(0.0, 1.0),
        (_cursor.dy + delta.dy * speed / (rect.height * _zoom)).clamp(0.0, 1.0),
      );
    });
    _moveTo(_cursor);
  }

  // --- Arrastres, desplazamiento y zoom ------------------------------------------------

  void _onScaleStart(ScaleStartDetails details) {
    _two = _TwoFingers.undecided;
    _startZoom = _zoom;
    _lastFocal = details.localFocalPoint;
    _scrollRemainder = 0;
    if (details.pointerCount == 1 && !widget.mouseMode) {
      // Arrastrar con un dedo en modo táctil: se pulsa donde empieza
      _dragging = true;
      _moveTo(_normalized(details.localFocalPoint), reliable: true);
      _session.sendInput(RemoteInput.button(0, down: true));
    }
  }

  void _onScaleUpdate(ScaleUpdateDetails details) {
    final focalDelta = details.localFocalPoint - _lastFocal;
    _lastFocal = details.localFocalPoint;
    if (details.pointerCount >= 2) {
      if (_dragging && !widget.mouseMode) _endTouchDrag();
      if (_two == _TwoFingers.undecided) {
        if ((details.scale - 1).abs() > 0.08) {
          _two = _TwoFingers.zoom;
        } else if (focalDelta.distance > 0 && (details.localFocalPoint - details.localFocalPoint).distance == 0 && _travel > 20) {
          _two = _TwoFingers.scroll;
        }
      }
      if (_two == _TwoFingers.zoom) {
        // Zoom alrededor de los dedos
        final newZoom = (_startZoom * details.scale).clamp(1.0, 5.0);
        final focal = details.localFocalPoint;
        final content = (focal - _pan) / _zoom;
        setState(() {
          _zoom = newZoom;
          _pan = focal - content * _zoom + focalDelta;
          _clampPan();
        });
      } else if (_two == _TwoFingers.scroll) {
        // Arrastrar el contenido hacia arriba baja la página (dy > 0), como en el móvil
        _scrollRemainder += -focalDelta.dy * 2;
        final dx = -focalDelta.dx * 2;
        if (_scrollRemainder.abs() >= 1 || dx.abs() >= 1) {
          _session.sendInput(RemoteInput.wheel(dx, _scrollRemainder));
          _scrollRemainder = 0;
        }
      }
      return;
    }
    if (widget.mouseMode) {
      _moveCursorBy(focalDelta);
    } else if (_dragging) {
      _moveTo(_normalized(details.localFocalPoint));
    } else if (_zoom > 1) {
      setState(() {
        _pan += focalDelta;
        _clampPan();
      });
    }
  }

  void _onScaleEnd(ScaleEndDetails details) {
    if (_dragging && !widget.mouseMode) _endTouchDrag();
  }

  void _endTouchDrag() {
    _dragging = false;
    _session.sendInput(RemoteInput.button(0, down: false));
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(builder: (context, constraints) {
      _box = constraints.biggest;
      return ValueListenableBuilder<RTCVideoValue>(
        valueListenable: _session.renderer,
        builder: (context, _, _) {
          final view = Transform(
            transform: Matrix4.identity()
              ..translateByDouble(_pan.dx, _pan.dy, 0, 1)
              ..scaleByDouble(_zoom, _zoom, 1, 1),
            child: SizedBox.fromSize(size: _box, child: RTCVideoView(_session.renderer, objectFit: RTCVideoViewObjectFit.RTCVideoViewObjectFitContain)),
          );
          if (!widget.enabled) return view;
          final cursor = _toScreen(_cursor);
          return Listener(
            onPointerDown: _onPointerDown,
            onPointerMove: _onPointerMove,
            onPointerUp: _onPointerUp,
            onPointerCancel: _onPointerUp,
            child: RawGestureDetector(
              behavior: HitTestBehavior.opaque,
              gestures: {
                TapGestureRecognizer: GestureRecognizerFactoryWithHandlers<TapGestureRecognizer>(TapGestureRecognizer.new, (r) => r.onTapUp = _onTapUp),
                LongPressGestureRecognizer: GestureRecognizerFactoryWithHandlers<LongPressGestureRecognizer>(LongPressGestureRecognizer.new, (r) {
                  r
                    ..onLongPressStart = _onLongPressStart
                    ..onLongPressMoveUpdate = _onLongPressMove
                    ..onLongPressEnd = _onLongPressEnd;
                }),
                ScaleGestureRecognizer: GestureRecognizerFactoryWithHandlers<ScaleGestureRecognizer>(ScaleGestureRecognizer.new, (r) {
                  r
                    ..onStart = _onScaleStart
                    ..onUpdate = _onScaleUpdate
                    ..onEnd = _onScaleEnd;
                }),
              },
              child: Stack(children: [
                Positioned.fill(child: view),
                if (widget.mouseMode)
                  // La punta de la flecha (arriba en el centro del icono) es donde se hace clic
                  Positioned(
                    left: cursor.dx - 11,
                    top: cursor.dy - 2,
                    child: const IgnorePointer(child: Icon(Icons.navigation, size: 22, color: Colors.white, shadows: [Shadow(blurRadius: 3)])),
                  ),
              ]),
            ),
          );
        },
      );
    });
  }
}

/// Campo invisible para el teclado del teléfono. Siempre contiene un texto fijo: si se acorta es
/// que se ha borrado (Retroceso), y lo que se añade es lo escrito. Espera a que termine la
/// composición (acentos, dictado) antes de enviar.
class _HiddenInput extends StatefulWidget {
  const _HiddenInput({required this.focusNode, required this.onText, required this.onKey});

  final FocusNode focusNode;
  final void Function(String text) onText;
  final void Function(String code) onKey;

  @override
  State<_HiddenInput> createState() => _HiddenInputState();
}

class _HiddenInputState extends State<_HiddenInput> {
  static const _sentinel = '  ';
  final _controller = TextEditingController(text: _sentinel);
  bool _resetting = false;

  @override
  void initState() {
    super.initState();
    _controller.addListener(_changed);
    _reset();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _reset() {
    _resetting = true;
    _controller.value = const TextEditingValue(text: _sentinel, selection: TextSelection.collapsed(offset: _sentinel.length));
    _resetting = false;
  }

  void _changed() {
    if (_resetting) return;
    final value = _controller.value;
    if (value.composing.isValid && !value.composing.isCollapsed) return;
    final text = value.text;
    if (text == _sentinel) return;
    if (_sentinel.startsWith(text)) {
      // Se ha borrado parte del texto fijo: Retroceso
      for (var i = 0; i < _sentinel.length - text.length; i++) {
        widget.onKey(RemoteKeys.backspace);
      }
    } else if (text.startsWith(_sentinel)) {
      final typed = text.substring(_sentinel.length);
      if (typed.isNotEmpty) widget.onText(typed);
    } else {
      final typed = text.trim();
      if (typed.isNotEmpty) widget.onText(typed);
    }
    _reset();
  }

  @override
  Widget build(BuildContext context) => Opacity(
        opacity: 0,
        child: TextField(
          key: const Key('remote-keyboard'),
          controller: _controller,
          focusNode: widget.focusNode,
          autocorrect: false,
          enableSuggestions: false,
          enableIMEPersonalizedLearning: false,
          textCapitalization: TextCapitalization.none,
          keyboardType: TextInputType.multiline,
          maxLines: null,
          textInputAction: TextInputAction.newline,
          showCursor: false,
          decoration: const InputDecoration(border: InputBorder.none, filled: false),
        ),
      );
}

/// Teclas que no hay en el teclado del teléfono. Los modificadores son de un toque: se aplican a la
/// siguiente tecla (de la barra o escrita) y se sueltan.
class _KeyBar extends StatelessWidget {
  const _KeyBar({required this.modifiers, required this.systemKey, required this.onModifier, required this.onKey});

  final Set<String> modifiers;
  final String systemKey;
  final void Function(String code) onModifier;
  final void Function(String code) onKey;

  @override
  Widget build(BuildContext context) {
    Widget key(String label, VoidCallback onTap, {bool active = false, Key? id}) => Padding(
          padding: const EdgeInsets.symmetric(horizontal: 3),
          child: Material(
            color: active ? AppColors.accent : AppColors.surfaceHigh,
            borderRadius: BorderRadius.circular(8),
            child: InkWell(
              key: id,
              borderRadius: BorderRadius.circular(8),
              onTap: onTap,
              child: Container(
                constraints: const BoxConstraints(minWidth: 44),
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
                alignment: Alignment.center,
                child: Text(label, style: const TextStyle(fontWeight: FontWeight.w600)),
              ),
            ),
          ),
        );
    Widget modifier(String label, String code) => key(label, () => onModifier(code), active: modifiers.contains(code), id: Key('remote-key-$code'));
    return Container(
      color: AppColors.surface,
      padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 4),
      child: SafeArea(
        top: false,
        child: SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(children: [
            key('Esc', () => onKey(RemoteKeys.escape), id: const Key('remote-key-Escape')),
            key('Tab', () => onKey(RemoteKeys.tab)),
            modifier('Ctrl', RemoteKeys.control),
            modifier('Alt', RemoteKeys.alt),
            modifier('⇧', RemoteKeys.shift),
            modifier(systemKey, RemoteKeys.meta),
            key('Supr', () => onKey(RemoteKeys.delete), id: const Key('remote-key-Delete')),
            key('←', () => onKey(RemoteKeys.arrowLeft)),
            key('↑', () => onKey(RemoteKeys.arrowUp)),
            key('↓', () => onKey(RemoteKeys.arrowDown)),
            key('→', () => onKey(RemoteKeys.arrowRight)),
            key('Inicio', () => onKey(RemoteKeys.home)),
            key('Fin', () => onKey(RemoteKeys.end)),
            key('RePág', () => onKey(RemoteKeys.pageUp)),
            key('AvPág', () => onKey(RemoteKeys.pageDown)),
            for (final f in RemoteKeys.functionKeys) key(f, () => onKey(f)),
          ]),
        ),
      ),
    );
  }
}

/// Barra de arriba: estado de la conexión y acciones. Se puede plegar para ver toda la pantalla.
class _Toolbar extends StatelessWidget {
  const _Toolbar({
    required this.expanded,
    required this.onExpanded,
    required this.session,
    required this.mouseMode,
    required this.keyboard,
    required this.onMode,
    required this.onKeyboard,
    required this.onClipboard,
    required this.onSendFile,
    required this.onSendPhoto,
    required this.onDownload,
    required this.onTransfers,
    required this.onDisconnect,
  });

  final bool expanded;
  final ValueChanged<bool> onExpanded;
  final ViewerSession session;
  final bool mouseMode;
  final bool keyboard;
  final VoidCallback onMode;
  final VoidCallback onKeyboard;
  final VoidCallback onClipboard;
  final VoidCallback onSendFile;
  final VoidCallback onSendPhoto;
  final VoidCallback onDownload;
  final VoidCallback? onTransfers;
  final VoidCallback onDisconnect;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    if (!expanded) {
      return Align(
        alignment: Alignment.topCenter,
        child: IconButton(
          key: const Key('remote-toolbar-show'),
          style: IconButton.styleFrom(backgroundColor: Colors.black54),
          icon: const Icon(Icons.expand_more, color: Colors.white),
          onPressed: () => onExpanded(true),
        ),
      );
    }
    final stats = session.stats;
    final status = [
      if (stats.relay != null) stats.relay! ? t.remoteRelay : t.remoteDirect,
      if (stats.rttMs != null) '${stats.rttMs} ms',
      if (stats.fps != null) '${stats.fps} fps',
    ].join(' · ');
    final features = session.features;
    return Container(
      margin: const EdgeInsets.all(6),
      padding: const EdgeInsets.symmetric(horizontal: 4),
      decoration: BoxDecoration(color: Colors.black.withValues(alpha: 0.65), borderRadius: BorderRadius.circular(12)),
      child: Row(children: [
        IconButton(tooltip: '', icon: const Icon(Icons.expand_less, color: Colors.white), onPressed: () => onExpanded(false)),
        Expanded(
          child: Text(status, key: const Key('remote-status'), maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Colors.white70, fontSize: 12)),
        ),
        IconButton(
          key: const Key('remote-mode'),
          tooltip: mouseMode ? t.remoteMouseMode : t.remoteTouchMode,
          icon: Icon(mouseMode ? Icons.mouse_outlined : Icons.touch_app_outlined, color: Colors.white),
          onPressed: onMode,
        ),
        IconButton(
          key: const Key('remote-keyboard-toggle'),
          tooltip: t.remoteKeyboard,
          icon: Icon(Icons.keyboard_outlined, color: keyboard ? AppColors.accentSoft : Colors.white),
          onPressed: onKeyboard,
        ),
        if (session.displays.length > 1)
          PopupMenuButton<String>(
            key: const Key('remote-displays'),
            icon: const Icon(Icons.monitor_outlined, color: Colors.white),
            onSelected: session.selectDisplay,
            itemBuilder: (context) => [
              for (final (index, display) in session.displays.indexed)
                CheckedPopupMenuItem(value: display.id, checked: display.id == session.currentDisplay, child: Text(t.remoteDisplay('${index + 1}'))),
            ],
          ),
        if (features.audio)
          IconButton(
            key: const Key('remote-mute'),
            tooltip: session.audioMuted ? t.remoteUnmute : t.remoteMute,
            icon: Icon(session.audioMuted ? Icons.volume_off_outlined : Icons.volume_up_outlined, color: Colors.white),
            onPressed: () => session.setAudioMuted(!session.audioMuted),
          ),
        PopupMenuButton<VoidCallback>(
          key: const Key('remote-more'),
          icon: const Icon(Icons.more_vert, color: Colors.white),
          onSelected: (action) => action(),
          itemBuilder: (context) => [
            PopupMenuItem(value: onClipboard, enabled: features.clipboard, child: ListTile(leading: const Icon(Icons.content_paste_go_outlined), title: Text(t.remoteSendClipboard))),
            PopupMenuItem(value: onSendFile, enabled: features.files, child: ListTile(leading: const Icon(Icons.upload_file_outlined), title: Text(t.remoteSendFile))),
            PopupMenuItem(value: onSendPhoto, enabled: features.files, child: ListTile(leading: const Icon(Icons.photo_outlined), title: Text(t.remoteSendPhoto))),
            PopupMenuItem(value: onDownload, enabled: features.files, child: ListTile(leading: const Icon(Icons.download_outlined), title: Text(t.remoteDownload))),
            if (onTransfers != null) PopupMenuItem(value: onTransfers, child: ListTile(leading: const Icon(Icons.swap_vert), title: Text(t.remoteTransfers))),
          ],
        ),
        IconButton(
          key: const Key('remote-disconnect'),
          tooltip: t.remoteDisconnect,
          icon: const Icon(Icons.close, color: AppColors.danger),
          onPressed: onDisconnect,
        ),
      ]),
    );
  }
}

/// Mientras se conecta, si falla o si el PC cierra la sesión.
class _StatusOverlay extends StatelessWidget {
  const _StatusOverlay({
    required this.session,
    required this.pcName,
    required this.closedInBackground,
    required this.onReconnect,
    required this.onBack,
    required this.backLabel,
  });

  final ViewerSession session;
  final String pcName;
  final bool closedInBackground;
  final VoidCallback onReconnect;
  final VoidCallback onBack;
  final String backLabel;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final busy = switch (session.phase) {
      ViewerPhase.idle || ViewerPhase.connecting => t.remoteConnecting,
      ViewerPhase.waiting => t.remoteWaitingPc,
      ViewerPhase.authenticating => t.remoteAuthenticating,
      ViewerPhase.reconnecting => t.remoteReconnecting,
      _ => null,
    };
    final failure = session.failure;
    final message = busy ??
        (session.phase == ViewerPhase.failed && failure != null
            ? RemoteTexts.error(t, failure.code, failure.retryAfter)
            : RemoteTexts.closedBy(t, closedInBackground ? 'background' : session.closedReason));
    return ColoredBox(
      color: Colors.black.withValues(alpha: 0.75),
      child: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              Text(pcName, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w600), textAlign: TextAlign.center),
              const SizedBox(height: 16),
              if (busy != null) const Padding(padding: EdgeInsets.only(bottom: 16), child: CircularProgressIndicator()),
              Text(
                message,
                key: const Key('remote-message'),
                textAlign: TextAlign.center,
                style: TextStyle(color: busy != null ? Colors.white70 : (session.phase == ViewerPhase.failed ? AppColors.danger : Colors.white70)),
              ),
              if (busy == null) ...[
                const SizedBox(height: 24),
                Row(mainAxisSize: MainAxisSize.min, children: [
                  OutlinedButton(onPressed: onBack, child: Text(backLabel)),
                  const SizedBox(width: 12),
                  FilledButton(key: const Key('remote-reconnect'), onPressed: onReconnect, child: Text(t.remoteReconnect)),
                ]),
              ],
            ]),
          ),
        ),
      ),
    );
  }
}

/// Explorador de las carpetas del PC para descargar un fichero.
class _RemoteBrowser extends StatefulWidget {
  const _RemoteBrowser({required this.transfers});

  final RemoteTransfers transfers;

  @override
  State<_RemoteBrowser> createState() => _RemoteBrowserState();
}

class _RemoteBrowserState extends State<_RemoteBrowser> {
  RemoteListing? _listing;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _open('');
  }

  Future<void> _open(String path) async {
    setState(() => _loading = true);
    final listing = await widget.transfers.list(path);
    if (!mounted) return;
    setState(() {
      _loading = false;
      _listing = listing ?? _listing;
    });
  }

  String _join(String dir, String name) {
    if (dir.isEmpty) return name;
    final separator = dir.contains('\\') && !dir.contains('/') ? '\\' : '/';
    return dir.endsWith(separator) ? '$dir$name' : '$dir$separator$name';
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final listing = _listing;
    return SizedBox(
      height: MediaQuery.sizeOf(context).height * 0.8,
      child: Column(children: [
        ListTile(
          leading: IconButton(
            tooltip: t.remoteUp,
            icon: const Icon(Icons.arrow_upward),
            onPressed: listing?.parent == null ? null : () => _open(listing!.parent!),
          ),
          title: Text(listing?.path ?? t.remoteDownload, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 14)),
          trailing: IconButton(icon: const Icon(Icons.close), onPressed: () => Navigator.pop(context)),
        ),
        const Divider(),
        if (_loading) const LinearProgressIndicator(),
        if (listing?.error != null) Padding(padding: const EdgeInsets.all(16), child: Text(RemoteTexts.transferError(t, listing!.error), style: const TextStyle(color: AppColors.danger))),
        if (listing != null && listing.truncated) Padding(padding: const EdgeInsets.all(8), child: Text(t.remoteTruncated, style: const TextStyle(color: AppColors.textSecondary))),
        Expanded(
          child: listing == null
              ? const SizedBox.shrink()
              : listing.entries.isEmpty
                  ? Center(child: Text(t.remoteFolderEmpty, style: const TextStyle(color: AppColors.textSecondary)))
                  : ListView(children: [
                      for (final entry in listing.entries)
                        ListTile(
                          leading: Icon(entry.dir ? Icons.folder : Icons.insert_drive_file_outlined, color: entry.dir ? AppColors.folder : AppColors.textSecondary),
                          title: Text(entry.name),
                          subtitle: entry.dir ? null : Text(_size(entry.size), style: const TextStyle(fontSize: 12)),
                          onTap: () => entry.dir
                              ? _open(_join(listing.path, entry.name))
                              : Navigator.pop(context, (path: _join(listing.path, entry.name), name: entry.name, size: entry.size)),
                        ),
                    ]),
        ),
      ]),
    );
  }
}

/// Transferencias de la sesión, con su progreso.
class _TransfersSheet extends StatelessWidget {
  const _TransfersSheet({required this.transfers});

  final RemoteTransfers transfers;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    return ListenableBuilder(
      listenable: transfers,
      builder: (context, _) => ListView(shrinkWrap: true, children: [
        ListTile(
          title: Text(t.remoteTransfers, style: const TextStyle(fontWeight: FontWeight.w600)),
          trailing: TextButton(onPressed: transfers.clearFinished, child: Text(t.remoteClearFinished)),
        ),
        for (final transfer in transfers.transfers.reversed)
          ListTile(
            leading: Icon(transfer.upload ? Icons.upload : Icons.download),
            title: Text(transfer.name, maxLines: 1, overflow: TextOverflow.ellipsis),
            subtitle: switch (transfer.status) {
              RemoteTransferStatus.waiting => Text(t.remoteQueued),
              RemoteTransferStatus.running => LinearProgressIndicator(value: transfer.size == 0 ? null : transfer.bytes / transfer.size),
              RemoteTransferStatus.done => Text(transfer.upload ? t.remoteSentAs(transfer.result ?? transfer.name) : _size(transfer.size)),
              RemoteTransferStatus.failed => Text(RemoteTexts.transferError(t, transfer.error), style: const TextStyle(color: AppColors.danger)),
              RemoteTransferStatus.cancelled => Text(t.remoteCancelled),
            },
            trailing: transfer.active
                ? IconButton(tooltip: t.cancel, icon: const Icon(Icons.close), onPressed: () => transfers.cancel(transfer))
                : (!transfer.upload && transfer.status == RemoteTransferStatus.done && transfer.result != null)
                    ? IconButton(
                        tooltip: t.remoteShare,
                        icon: const Icon(Icons.ios_share),
                        onPressed: () => SharePlus.instance.share(ShareParams(files: [XFile(transfer.result!)])),
                      )
                    : null,
          ),
      ]),
    );
  }
}

String _size(int bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  var value = bytes.toDouble();
  var unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return '${value.toStringAsFixed(unit == 0 ? 0 : 1)} ${units[unit]}';
}
