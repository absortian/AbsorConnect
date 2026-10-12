// Recorrido completo en un emulador contra el backend de desarrollo y los servidores de
// pruebas de tool/test_env.sh (el emulador de Android llega al Mac por 10.0.2.2):
//   flutter drive --driver=test_driver/integration_test.dart --target=integration_test/app_test.dart \
//     --dart-define=API_URL=http://10.0.2.2:8020 --dart-define=TEST_HOST=10.0.2.2
import 'package:absor_connect/main.dart';
import 'package:absor_connect/src/services.dart';
import 'package:absor_connect/src/terminals.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

const host = String.fromEnvironment('TEST_HOST', defaultValue: '10.0.2.2');

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('cuenta, conexiones, SFTP, terminal y S3 en el móvil', (tester) async {
    final services = AppServices.create();
    await tester.pumpWidget(AbsorConnectApp(services: services));
    await binding.convertFlutterSurfaceToImage();

    Future<void> waitFor(Finder finder, {int seconds = 30}) async {
      for (var i = 0; i < seconds * 5; i++) {
        await tester.pump(const Duration(milliseconds: 200));
        if (finder.evaluate().isNotEmpty) return;
      }
      throw TestFailure('No apareció: $finder');
    }

    Future<void> shot(String name) async {
      await tester.pumpAndSettle(const Duration(milliseconds: 300));
      await binding.takeScreenshot(name);
    }

    // Los formularios son listas perezosas: lo que no se ve aún no existe hasta desplazarse
    Future<void> reveal(Finder finder) async {
      if (finder.evaluate().isEmpty) {
        await tester.scrollUntilVisible(finder, 120, scrollable: find.byType(Scrollable).last);
      }
      await tester.ensureVisible(finder);
      await tester.pumpAndSettle();
    }

    Future<void> fill(String key, String text) async {
      final field = find.byKey(Key(key));
      await reveal(field);
      await tester.enterText(field, text);
    }

    // 1. Primer arranque: pantalla de acceso; crear cuenta
    await waitFor(find.byKey(const Key('auth-email')));
    await shot('01-acceso');
    await tester.tap(find.text('Create account').first);
    await tester.pumpAndSettle();
    final email = 'movil-${DateTime.now().millisecondsSinceEpoch}@ejemplo.com';
    await fill('auth-email', email);
    await fill('auth-password', 'contraseña-movil-1');
    await fill('auth-confirmation', 'contraseña-movil-1');
    await tester.tap(find.byKey(const Key('auth-submit')));
    await waitFor(find.textContaining('No connections yet'));
    await shot('02-sin-conexiones');

    // 2. Conexión SSH desde el formulario
    Future<void> openForm() async {
      await tester.tap(find.byKey(const Key('add')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('add-connection')));
      await tester.pumpAndSettle();
    }

    await openForm();
    await tester.tap(find.text('SSH / SFTP'));
    await tester.pumpAndSettle();
    await fill('form-name', 'Servidor de pruebas');
    await fill('form-host', host);
    await fill('form-port', '2222');
    await fill('form-username', 'test');
    await fill('form-password', 'test');
    await shot('03-formulario-ssh');
    await reveal(find.byKey(const Key('form-save')));
    await tester.tap(find.byKey(const Key('form-save')));
    await waitFor(find.byKey(const Key('entry-Servidor de pruebas')));

    // 3. Conexión S3
    await openForm();
    await fill('form-name', 'Almacén S3');
    await fill('form-endpoint', 'http://$host:7070');
    await fill('form-access-key', 'testkey');
    await fill('form-secret-key', 'testsecret-1234');
    await reveal(find.byKey(const Key('form-save')));
    await tester.tap(find.byKey(const Key('form-save')));
    await waitFor(find.byKey(const Key('entry-Almacén S3')));
    expect(services.connections.entries.map((e) => e.name), ['Servidor de pruebas', 'Almacén S3']);
    await shot('04-conexiones');

    // 4. Explorador SFTP: carpeta nueva y borrarla
    await tester.tap(find.byKey(const Key('entry-Servidor de pruebas')));
    await waitFor(find.byKey(const Key('item-.ssh')));
    expect(find.textContaining('test@$host:'), findsOneWidget);
    await tester.tap(find.byKey(const Key('explorer-mkdir')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('ask-text')), 'desde-el-movil');
    await tester.tap(find.byKey(const Key('ask-ok')));
    await waitFor(find.byKey(const Key('item-desde-el-movil')));
    await shot('05-sftp');
    await tester.tap(find.byKey(const Key('item-menu-desde-el-movil')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('item-delete')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('confirm-delete')));
    for (var i = 0; i < 50 && find.byKey(const Key('item-desde-el-movil')).evaluate().isNotEmpty; i++) {
      await tester.pump(const Duration(milliseconds: 200));
    }
    expect(find.byKey(const Key('item-desde-el-movil')), findsNothing);

    // 5. Terminal desde el explorador: un comando y Ctrl+C con la barra de teclas
    await tester.tap(find.byIcon(Icons.terminal).first);
    final session = services.terminals.sessions.single;
    for (var i = 0; i < 100 && session.status != TerminalStatus.open; i++) {
      await tester.pump(const Duration(milliseconds: 200));
    }
    expect(session.status, TerminalStatus.open);
    Future<void> waitScreen(String text) async {
      for (var i = 0; i < 100 && !session.terminal.buffer.getText().contains(text); i++) {
        await tester.pump(const Duration(milliseconds: 200));
      }
      expect(session.terminal.buffer.getText(), contains(text));
    }

    session.terminal.textInput('echo hola-desde-el-movil-\$((6*7))\r');
    await waitScreen('hola-desde-el-movil-42');
    session.terminal.textInput('sleep 30; echo fin-\$((40+2))\r');
    await tester.pump(const Duration(milliseconds: 600));
    await tester.tap(find.byKey(const Key('key-ctrl')));
    await tester.pump();
    session.terminal.textInput('c'); // Ctrl de un toque + C = interrupción
    session.terminal.textInput('echo tras-ctrl-c\r');
    await waitScreen('tras-ctrl-c');
    expect(session.terminal.buffer.getText(), isNot(contains('fin-42')));
    await shot('06-terminal');
    await tester.pageBack(); // terminal → explorador
    await tester.pumpAndSettle();
    await tester.pageBack(); // explorador (en su carpeta inicial) → lista
    await waitFor(find.byKey(const Key('add')));

    // 6. S3: lista de buckets y dentro de uno
    await tester.tap(find.byKey(const Key('entry-Almacén S3')));
    await waitFor(find.byKey(const Key('item-pruebas')));
    await tester.tap(find.byKey(const Key('item-pruebas')));
    await waitFor(find.textContaining('s3://pruebas/'));
    await shot('07-s3');
    await tester.pageBack(); // bucket → lista de buckets (la carpeta inicial)
    await tester.pumpAndSettle();
    await tester.pageBack(); // → lista de conexiones
    await waitFor(find.byKey(const Key('add')));

    // 7. Ajustes y cerrar sesión: cierra las terminales y vuelve a la pantalla de acceso
    expect(services.terminals.sessions, hasLength(1));
    await tester.tap(find.byKey(const Key('open-settings')));
    await tester.pumpAndSettle();
    expect(find.text(email), findsOneWidget);
    await shot('08-ajustes');
    await tester.tap(find.byKey(const Key('settings-logout')));
    await waitFor(find.byKey(const Key('auth-email')));
    expect(services.terminals.sessions, isEmpty);
    expect(services.session.isSignedIn, isFalse);
  });
}
