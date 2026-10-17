// Control remoto desde el móvil contra un PC de verdad (add-remote-desktop 7.3): el PC es la app de
// escritorio con la prueba entre dos equipos (prototypes/remote-desktop/lan-check/pc.ts), que anota
// en su sonda los clics, las teclas y el texto que le llegan. Lo lanza
// prototypes/remote-desktop/mobile-check/run.sh, que hace las capturas con adb cuando la prueba
// escribe "SHOT <nombre>" (así salen con la imagen del PC) y pulsa Inicio o Atrás cuando lo pide.
//
//   flutter drive --driver=test_driver/integration_test.dart --target=integration_test/remote_desktop_test.dart \
//     --dart-define=API_URL=http://10.0.2.2:8020 --dart-define=PROBE_URL=http://10.0.2.2:8790
import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:absor_connect/main.dart';
import 'package:absor_connect/src/services.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:http/http.dart' as http;
import 'package:integration_test/integration_test.dart';
import 'package:share_plus/share_plus.dart' show XFile;

const probeUrl = String.fromEnvironment('PROBE_URL', defaultValue: 'http://10.0.2.2:8790');
const accountEmail = String.fromEnvironment('ACCOUNT_EMAIL', defaultValue: 'prueba-control-local@example.test');
const accountPassword = String.fromEnvironment('ACCOUNT_PASSWORD', defaultValue: 'contraseña-de-prueba-larga');
const pcPassword = String.fromEnvironment('PC_PASSWORD', defaultValue: 'contraseña-del-pc-prueba');

/// Resultado de cada comprobación, que se imprime al final como JSON en base64 ("REPORT i/n …").
final _checks = <Map<String, Object?>>[];

void _check(String name, bool ok, [Object? detail]) {
  _checks.add({'name': name, 'ok': ok, 'detail': detail});
  // ignore: avoid_print
  print('${ok ? 'OK   ' : 'FALLO'} $name ${jsonEncode(detail).substring(0, (jsonEncode(detail).length).clamp(0, 300))}');
}

Future<Map<String, dynamic>> _probe(String path, [Map<String, Object?>? body]) async {
  final uri = Uri.parse('$probeUrl$path');
  final response = body == null ? await http.get(uri) : await http.post(uri, headers: {'Content-Type': 'application/json'}, body: jsonEncode(body));
  final data = jsonDecode(utf8.decode(response.bodyBytes));
  return data is Map<String, dynamic> ? data : {'value': data};
}

/// Un "fichero elegido en Fotos" sin el selector del sistema.
final class _PickedFile extends PlatformFile {
  _PickedFile(this.file);

  final File file;

  @override
  String get name => file.uri.pathSegments.last;
  @override
  Uri get uri => file.uri;
  @override
  XFile get xFile => XFile(file.path);
  @override
  int? lengthSync() => file.lengthSync();
  @override
  Future<int?> length() async => file.lengthSync();
  @override
  Future<Uint8List> readAsBytes() => file.readAsBytes();
  @override
  Stream<Uint8List> readAsByteStream() => file.openRead().map(Uint8List.fromList);
}

class _FakePicker extends FilePickerPlatform {
  File? next;

  @override
  Future<List<PlatformFile>> pickFiles({
    String? dialogTitle,
    String? initialDirectory,
    FileType type = FileType.any,
    List<String>? allowedExtensions,
    Function(FilePickerStatus)? onFileLoading,
    int compressionQuality = 0,
    AndroidOptions androidOptions = const AndroidOptions(),
    DarwinOptions darwinOptions = const DarwinOptions(),
    WindowsOptions windowsOptions = const WindowsOptions(),
    LinuxOptions linuxOptions = const LinuxOptions(),
    WebOptions webOptions = const WebOptions(),
  }) async {
    final file = next;
    next = null;
    return file == null ? const [] : [_PickedFile(file)];
  }
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  final picker = _FakePicker();
  FilePickerPlatform.instance = picker;

  testWidgets('control remoto desde el móvil contra un PC de verdad', (tester) async {
    // Sin convertFlutterSurfaceToImage(): las capturas las hace adb, y con esa conversión adb ve
    // el lienzo de Flutter vacío
    await tester.pumpWidget(AbsorConnectApp(services: AppServices.create()));

    Future<bool> waitFor(bool Function() condition, {int seconds = 30}) async {
      for (var i = 0; i < seconds * 5; i++) {
        await tester.pump(const Duration(milliseconds: 200));
        if (condition()) return true;
      }
      return condition();
    }

    Future<bool> waitForProbe(bool Function(Map<String, dynamic> state) condition, {int seconds = 10}) async {
      for (var i = 0; i < seconds * 4; i++) {
        await tester.pump(const Duration(milliseconds: 250));
        if (condition(await _probe('/state'))) return true;
      }
      return false;
    }

    /// Pide una acción al script de fuera (captura, Inicio, Atrás) y le da tiempo.
    Future<void> outside(String command, {Duration wait = const Duration(seconds: 2)}) async {
      // ignore: avoid_print
      print(command);
      final end = DateTime.now().add(wait);
      while (DateTime.now().isBefore(end)) {
        await tester.pump(const Duration(milliseconds: 100));
      }
    }

    String statusText() {
      final status = find.byKey(const Key('remote-status'));
      return status.evaluate().isEmpty ? '' : tester.widget<Text>(status).data ?? '';
    }

    bool connected() => statusText().contains('fps');

    List<Map<String, dynamic>> events(Map<String, dynamic> state) =>
        ((state['target'] as Map?)?['events'] as List? ?? const []).cast<Map<String, dynamic>>();

    /// Rectángulo de la imagen del PC en la pantalla del móvil (ajustada sin recortar).
    Rect imageRect(Map<String, dynamic> pcState) {
      final view = tester.getRect(find.byType(RTCVideoView));
      final display = ((pcState['displays'] as List).cast<Map<String, dynamic>>()).firstWhere((d) => d['primary'] == true);
      final bounds = display['bounds'] as Map<String, dynamic>;
      final w = (bounds['width'] as num).toDouble(), h = (bounds['height'] as num).toDouble();
      final scale = (view.width / w) < (view.height / h) ? view.width / w : view.height / h;
      final size = Size(w * scale, h * scale);
      return Rect.fromCenter(center: view.center, width: size.width, height: size.height);
    }

    // 1. Acceso con la cuenta de prueba y Equipos
    await waitFor(() => find.byKey(const Key('auth-email')).evaluate().isNotEmpty);
    await tester.enterText(find.byKey(const Key('auth-email')), accountEmail);
    await tester.enterText(find.byKey(const Key('auth-password')), accountPassword);
    await tester.tap(find.byKey(const Key('auth-submit')));
    await waitFor(() => find.byKey(const Key('open-devices')).evaluate().isNotEmpty);
    await tester.tap(find.byKey(const Key('open-devices')));
    final pcTile = find.ancestor(of: find.textContaining('PC de prueba'), matching: find.byType(ListTile));
    final listed = await waitFor(() => pcTile.evaluate().isNotEmpty && find.descendant(of: pcTile.first, matching: find.textContaining('Available')).evaluate().isNotEmpty);
    await outside('SHOT 01-equipos');
    _check('Equipos muestra el PC disponible', listed);

    // 2. Conectar con la contraseña
    await tester.tap(find.descendant(of: pcTile.first, matching: find.byType(FilledButton)));
    await waitFor(() => find.byKey(const Key('pc-password')).evaluate().isNotEmpty);
    await tester.enterText(find.byKey(const Key('pc-password')), pcPassword);
    await tester.tap(find.byKey(const Key('pc-password-connect')));
    final started = DateTime.now();
    final ok = await waitFor(connected, seconds: 60);
    await outside('SHOT 02-conectado', wait: const Duration(seconds: 3));
    _check('Conectar desde el móvil: se ve la pantalla del PC', ok, {'seconds': DateTime.now().difference(started).inMilliseconds / 1000, 'status': statusText()});
    if (!ok) {
      final message = find.byKey(const Key('remote-message'));
      _check('mensaje del visor', false, message.evaluate().isEmpty ? null : tester.widget<Text>(message).data);
      return;
    }
    var pc = await _probe('/state');
    // Las funciones que permite el PC (portapapeles, ficheros, sonido) llegan tras la captura
    final features = await waitFor(() => find.byKey(const Key('remote-mute')).evaluate().isNotEmpty, seconds: 10);
    _check('el móvil recibe las funciones que permite el PC', features, (pc['settings'] as Map?)?['features']);

    // 3. Girar el teléfono
    await SystemChrome.setPreferredOrientations([DeviceOrientation.landscapeLeft]);
    await outside('ROTATE landscape', wait: const Duration(seconds: 4));
    final landscape = tester.view.physicalSize.width > tester.view.physicalSize.height;
    await outside('SHOT 03-horizontal', wait: const Duration(seconds: 2));
    _check('Girar el teléfono: la imagen se adapta sin cortar la sesión', landscape && connected(), {'size': '${tester.view.physicalSize}', 'status': statusText()});
    await SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp]);
    await outside('ROTATE portrait', wait: const Duration(seconds: 4));
    await SystemChrome.setPreferredOrientations([]);

    // 4. Modo ratón: arrastrar un dedo mueve el puntero (como un trackpad), tocar hace clic donde
    // está el puntero y dos dedos a la vez, clic derecho (solo ese). El puntero se lleva antes hacia
    // el 25 % de la pantalla del PC, sobre la ventana de la sonda: en el centro puede estar la de la app
    pc = await _probe('/state');
    final view = tester.getRect(find.byType(RTCVideoView));
    final mouseRect = imageRect(pc);
    final primary = (pc['displays'] as List).cast<Map<String, dynamic>>().firstWhere((d) => d['primary'] == true)['bounds'] as Map<String, dynamic>;
    Offset cursorOnPc() {
      // La punta de la flecha del puntero: arriba en el centro del icono (22 px)
      final tip = tester.getTopLeft(find.byIcon(Icons.navigation)) + const Offset(11, 2);
      final nx = (tip.dx - mouseRect.left) / mouseRect.width, ny = (tip.dy - mouseRect.top) / mouseRect.height;
      return Offset((primary['x'] as num) + (primary['width'] as num) * nx, (primary['y'] as num) + (primary['height'] as num) * ny);
    }

    final startCursor = cursorOnPc();
    final drag = await tester.startGesture(view.center);
    final travel = Offset(-mouseRect.width * 0.25 / 1.4 - 30, -mouseRect.height * 0.25 / 1.4 - 30);
    for (var i = 1; i <= 20; i++) {
      await drag.moveTo(view.center + travel * (i / 20));
      await tester.pump(const Duration(milliseconds: 16));
    }
    await drag.up();
    await tester.pump(const Duration(milliseconds: 300));
    final cursor = cursorOnPc();
    _check('modo ratón: arrastrar un dedo mueve el puntero', cursor.dx < startCursor.dx - 200 && cursor.dy < startCursor.dy - 100,
        {'from': '${startCursor.dx.round()},${startCursor.dy.round()}', 'to': '${cursor.dx.round()},${cursor.dy.round()}'});

    bool near(Map<String, dynamic> e) => ((e['x'] as num) - cursor.dx).abs() <= 12 && ((e['y'] as num) - cursor.dy).abs() <= 12;
    await _probe('/reset', {});
    // Se toca lejos del puntero: el clic va donde está el puntero, no donde se toca
    await tester.tapAt(view.center + const Offset(0, 120));
    await waitForProbe((s) => events(s).any((e) => e['type'] == 'mousedown' && e['button'] == 0));
    final left = events(await _probe('/state')).where((e) => e['type'] == 'mousedown').toList();
    _check('modo ratón: tocar hace clic donde está el puntero', left.length == 1 && left.first['button'] == 0 && near(left.first),
        {'pc': left, 'cursor': '${cursor.dx.round()},${cursor.dy.round()}'});
    await _probe('/reset', {});
    final a = await tester.startGesture(view.center.translate(-40, 0), pointer: 11);
    final b = await tester.startGesture(view.center.translate(40, 0), pointer: 12);
    await tester.pump(const Duration(milliseconds: 80));
    await a.up();
    await b.up();
    await waitForProbe((s) => events(s).any((e) => e['type'] == 'mousedown' && e['button'] == 2));
    await tester.pump(const Duration(milliseconds: 500));
    final right = events(await _probe('/state')).where((e) => e['type'] == 'mousedown').toList();
    _check('Clic derecho: dos dedos a la vez en modo ratón (sin clic izquierdo)', right.length == 1 && right.first['button'] == 2 && near(right.first), right);

    // 5. Modo táctil: el toque hace clic donde se toca (al 25 % de la imagen)
    await tester.tap(find.byKey(const Key('remote-mode')));
    await tester.pump(const Duration(milliseconds: 300));
    pc = await _probe('/state');
    final rect = imageRect(pc);
    await _probe('/reset', {});
    await tester.tapAt(Offset(rect.left + rect.width * 0.25, rect.top + rect.height * 0.25));
    final touched = await waitForProbe((s) => events(s).any((e) => e['type'] == 'mousedown'));
    final down = events(await _probe('/state')).firstWhere((e) => e['type'] == 'mousedown', orElse: () => {});
    final display = (pc['displays'] as List).cast<Map<String, dynamic>>().firstWhere((d) => d['primary'] == true)['bounds'] as Map<String, dynamic>;
    final expected = Offset((display['x'] as num) + (display['width'] as num) * 0.25, (display['y'] as num) + (display['height'] as num) * 0.25);
    final dx = ((down['x'] as num? ?? -9999) - expected.dx).abs(), dy = ((down['y'] as num? ?? -9999) - expected.dy).abs();
    _check('modo táctil: el toque hace clic donde se toca', touched && dx <= 12 && dy <= 12, {'pc': down, 'expected': '${expected.dx},${expected.dy}'});

    // 6. Escribir "Mañana" y Ctrl+C con la barra de teclas
    await tester.tap(find.byKey(const Key('remote-keyboard-toggle')));
    await tester.pump(const Duration(milliseconds: 500));
    await outside('SHOT 04-teclado', wait: const Duration(seconds: 2));
    await _probe('/reset', {});
    await tester.enterText(find.byKey(const Key('remote-keyboard')), 'Mañana');
    final typed = await waitForProbe((s) => (s['target'] as Map?)?['text'] == 'Mañana');
    _check('Escribir texto: en el PC aparece "Mañana"', typed, (await _probe('/state'))['target']?['text']);
    await _probe('/reset', {});
    await tester.tap(find.byKey(const Key('remote-key-ControlLeft')));
    await tester.pump(const Duration(milliseconds: 200));
    await tester.enterText(find.byKey(const Key('remote-keyboard')), 'c');
    final ctrlC = await waitForProbe((s) => events(s).any((e) => e['type'] == 'keydown' && e['code'] == 'ControlLeft') && events(s).any((e) => e['type'] == 'keydown' && e['code'] == 'KeyC'));
    _check('Combinación con Ctrl: el PC recibe Ctrl+C', ctrlC, events(await _probe('/state')).where((e) => e['type'] == 'keydown').map((e) => e['code']).toList());
    await tester.tap(find.byKey(const Key('remote-keyboard-toggle')));
    await tester.pump(const Duration(milliseconds: 500));

    // 7. Portapapeles en los dos sentidos
    await _probe('/app', {'action': 'clipboard-set', 'text': 'Desde el PC: ¿ñ? €'});
    String? phoneClipboard;
    final fromPc = await waitFor(() => false, seconds: 3).then((_) async {
      for (var i = 0; i < 20; i++) {
        phoneClipboard = (await Clipboard.getData(Clipboard.kTextPlain))?.text;
        if (phoneClipboard == 'Desde el PC: ¿ñ? €') return true;
        await tester.pump(const Duration(milliseconds: 250));
      }
      return false;
    });
    _check('Copiar desde el PC: se puede pegar en el teléfono', fromPc, phoneClipboard);
    await Clipboard.setData(const ClipboardData(text: 'Desde el móvil: Mañana 😀'));
    await tester.tap(find.byKey(const Key('remote-more')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Send clipboard to the PC'));
    final toPc = await waitForProbe((s) => (s['clipboard'] as Map?)?['text'] == 'Desde el móvil: Mañana 😀');
    _check('portapapeles del móvil al PC', toPc, (await _probe('/state'))['clipboard']?['text']);

    // 8. Enviar una foto (el selector se sustituye por un fichero de prueba)
    await _probe('/app', {'action': 'cleanup-received'});
    final dir = await Directory.systemTemp.createTemp('foto');
    final photo = File('${dir.path}/absor-prueba-foto-movil.jpg');
    final bytes = Uint8List.fromList(List<int>.generate(300 * 1024 + 7, (i) => (i * 31) & 0xff));
    await photo.writeAsBytes(bytes);
    picker.next = photo;
    await tester.pump(const Duration(seconds: 1));
    await tester.tap(find.byKey(const Key('remote-more')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Send photo or video'));
    final sent = await waitForProbe((s) => ((s['received'] as List?) ?? const []).any((f) => (f as Map)['name'] == 'absor-prueba-foto-movil.jpg' && f['size'] == bytes.length), seconds: 30);
    await outside('SHOT 05-foto-enviada', wait: const Duration(seconds: 2));
    _check('Enviar una foto: aparece en la carpeta de recepción del PC', sent, (await _probe('/state'))['received']);
    if (find.byType(BottomSheet).evaluate().isNotEmpty) {
      await outside('BACK', wait: const Duration(seconds: 2));
    }

    // 9. Volver enseguida: 10 s fuera de la app con el botón Inicio
    await outside('HOME 10', wait: const Duration(seconds: 16));
    final stillThere = await waitFor(connected, seconds: 30);
    await outside('SHOT 06-tras-10s-fuera', wait: const Duration(seconds: 2));
    _check('Volver enseguida: la sesión sigue o se recupera sola sin pedir la contraseña', stillThere && find.byKey(const Key('pc-password')).evaluate().isEmpty, statusText());

    // 10. Volver tarde: más de 30 s en segundo plano cierra la sesión
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    // En pausa no hay fotogramas: aquí no se puede bombear con tester.pump (se quedaría esperando)
    // ignore: avoid_print
    print('WAIT 35');
    await Future<void>.delayed(const Duration(seconds: 35));
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    final message = find.byKey(const Key('remote-message'));
    final closed = await waitFor(() => message.evaluate().isNotEmpty);
    final text = closed ? tester.widget<Text>(message).data ?? '' : '';
    await outside('SHOT 07-cerrada-en-segundo-plano', wait: const Duration(seconds: 2));
    final pcFree = await waitForProbe((s) => (s['settings'] as Map?)?['active'] == false, seconds: 15);
    _check('Volver tarde: la sesión está cerrada y se puede volver a conectar', text.contains('30 seconds') && find.byKey(const Key('remote-reconnect')).evaluate().isNotEmpty && pcFree, text);

    // 11. Reconectar sin pedir la contraseña (K en memoria) y desconectar
    await tester.tap(find.byKey(const Key('remote-reconnect')));
    final again = await waitFor(connected, seconds: 60);
    _check('reconectar después sin volver a escribir la contraseña', again && find.byKey(const Key('pc-password')).evaluate().isEmpty, statusText());
    await tester.tap(find.byKey(const Key('remote-disconnect')));
    await waitFor(() => find.byKey(const Key('remote-disconnect')).evaluate().isEmpty);
    final released = await waitForProbe((s) => (s['settings'] as Map?)?['active'] == false, seconds: 15);
    _check('Desconectar libera el PC', released);
  }, timeout: const Timeout(Duration(minutes: 15)));

  tearDownAll(() {
    // ignore: avoid_print
    // En base64 y a trozos: Android parte las líneas largas del registro
    final report = base64.encode(utf8.encode(jsonEncode({'checks': _checks})));
    const size = 800;
    final parts = (report.length / size).ceil();
    for (var i = 0; i < parts; i++) {
      // ignore: avoid_print
      print('REPORT ${i + 1}/$parts ${report.substring(i * size, ((i + 1) * size).clamp(0, report.length))}');
    }
  });
}
