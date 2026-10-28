import 'package:absor_connect/l10n/app_localizations.dart';
import 'package:absor_connect/src/remote/agent_protocol.dart';
import 'package:absor_connect/src/remote/agent_viewer_state.dart';
import 'package:absor_connect/ui/agent_context_notice.dart';
import 'package:absor_connect/ui/sensitive_context_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  for (final language in ['es', 'en']) {
    testWidgets(
      'avisa de imagen anterior y funciones suspendidas, $language a 320 px',
      (tester) async {
        await tester.binding.setSurfaceSize(const Size(320, 640));
        addTearDown(() => tester.binding.setSurfaceSize(null));
        const status = AgentViewerStatus(
          enabled: true,
          sequence: 2,
          state: AgentContext.transition,
          imageAvailable: false,
          inputAllowed: false,
          sensitiveAllowed: false,
        );
        await tester.pumpWidget(
          MaterialApp(
            locale: Locale(language),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: const Scaffold(
              body: AgentContextNotice(status: status, imageCurrent: false),
            ),
          ),
        );
        expect(
          find.text(
            language == 'es' ? 'Cambiando de contexto' : 'Changing context',
          ),
          findsOneWidget,
        );
        expect(tester.takeException(), isNull);
      },
    );
  }
  testWidgets('una hoja elimina solo su ruta al cambiar el contexto', (
    tester,
  ) async {
    final changes = ValueNotifier<int>(0);
    addTearDown(changes.dispose);
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              onPressed: () => showModalBottomSheet<void>(
                context: context,
                builder: (_) => SensitiveContextSheet(
                  listenable: changes,
                  epoch: () => changes.value,
                  child: const Text('datos ficticios'),
                ),
              ),
              child: const Text('visor'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('visor'));
    await tester.pumpAndSettle();
    expect(find.text('datos ficticios'), findsOneWidget);
    changes.value++;
    await tester.pumpAndSettle();
    expect(find.text('datos ficticios'), findsNothing);
    expect(find.text('visor'), findsOneWidget);
  });
  testWidgets('las estadísticas no cierran la hoja; retirar permiso sí', (
    tester,
  ) async {
    final changes = ValueNotifier<int>(0);
    addTearDown(changes.dispose);
    var allowed = true;
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => TextButton(
            onPressed: () => showModalBottomSheet<void>(
              context: context,
              builder: (_) => SensitiveContextSheet(
                listenable: changes,
                epoch: () => 1,
                allowed: () => allowed,
                child: const Text('archivo ficticio'),
              ),
            ),
            child: const Text('abrir'),
          ),
        ),
      ),
    );
    await tester.tap(find.text('abrir'));
    await tester.pumpAndSettle();
    changes.value++;
    await tester.pumpAndSettle();
    expect(find.text('archivo ficticio'), findsOneWidget);
    allowed = false;
    changes.value++;
    await tester.pumpAndSettle();
    expect(find.text('archivo ficticio'), findsNothing);
  });
}
