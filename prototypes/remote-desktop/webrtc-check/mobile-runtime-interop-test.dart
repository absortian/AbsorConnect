// Pantalla y sesión de producción; API local del laboratorio sin tokens en el móvil.
import 'dart:async';
import 'dart:convert';

import 'package:absor_connect/l10n/app_localizations.dart';
import 'package:absor_connect/src/api.dart';
import 'package:absor_connect/src/session.dart';
import 'package:absor_connect/src/remote/input.dart';
import 'package:absor_connect/src/remote/monotonic_clock.dart';
import 'package:absor_connect/src/remote/remote_api.dart';
import 'package:absor_connect/src/remote/viewer_session.dart';
import 'package:absor_connect/ui/viewer_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:integration_test/integration_test.dart';

const endpoint = String.fromEnvironment('ABSOR_NATIVE_LAB_URL');
const deviceId = '12345678-1234-4abc-8def-123456789abc';
Future<Map<String, dynamic>> request(
  String path,
  Map<String, dynamic> body,
) async {
  final r = await http
      .post(
        Uri.parse('$endpoint/$path'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode(body),
      )
      .timeout(const Duration(seconds: 110));
  if (r.statusCode != 200) throw StateError('lab_http_${r.statusCode}');
  return jsonDecode(r.body) as Map<String, dynamic>;
}

Future<void> until(
  bool Function() condition, [
  String Function()? detail,
]) async {
  final deadline = DateTime.now().add(const Duration(seconds: 35));
  while (!condition()) {
    if (DateTime.now().isAfter(deadline)) {
      throw StateError('runtime_timeout_${detail?.call() ?? 'no_detail'}');
    }
    await Future<void>.delayed(const Duration(milliseconds: 30));
  }
}

// runAsync registra excepciones sin propagarlas: no continuar tras una fase fallida.
Future<void> runLive(
  WidgetTester tester,
  Future<void> Function() callback,
) async {
  Object? failure;
  StackTrace? trace;
  await tester.runAsync(() async {
    try {
      await callback();
    } catch (error, stack) {
      failure = error;
      trace = stack;
    }
  });
  if (failure != null) Error.throwWithStackTrace(failure!, trace!);
}

class LocalApi extends RemoteApi {
  LocalApi(this.name, this.config)
    : super(Session(ApiClient(baseUrl: 'https://example.invalid')));
  final String name;
  final Map<String, dynamic> config;
  Future<Map<String, dynamic>>? native;
  String answer = '';
  bool requested = false;
  int requests = 0;
  @override
  Future<List<Map<String, dynamic>>> iceServers() async =>
      (config['iceServers'] as List).cast<Map<String, dynamic>>();
  @override
  Future<String> createRequest(String id, String offer) async {
    requests++;
    if (id != deviceId) throw StateError('wrong_device');
    if (requested && (name != 'correct' || requests > 2)) throw ApiError('device_not_found', 404);
    final slot = requested ? 'correct-auto-reconnect' : name;
    requested = true;
    native = request('protected/$slot/run', {});
    unawaited(
      native!.then<void>((_) {}, onError: (Object _, StackTrace __) {}),
    );
    answer =
        (await request('mobile/offer/$slot', {'sdp': offer}))['sdp'] as String;
    final audio = answer
        .replaceAll('\r\n', '\n')
        .split('\nm=')
        .where((s) => s.startsWith('audio '))
        .toList();
    if (audio.length != 1 ||
        !RegExp(r'^a=inactive$', multiLine: true).hasMatch(audio.single)) {
      throw StateError('fixture_audio_not_inactive');
    }
    return deviceId;
  }

  @override
  Future<RequestStatus> poll(String id) async => RequestAnswered(answer);
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized().framePolicy =
      LiveTestWidgetsFlutterBindingFramePolicy.fullyLive;
  for (final name in ['correct', 'correct-reconnect']) {
    testWidgets('pantalla/runtime real ↔ trabajador IPC: $name', (
      tester,
    ) async {
      final configuration = await http.get(
        Uri.parse('$endpoint/mobile/config'),
      );
      expect(configuration.statusCode, 200);
      final config = jsonDecode(configuration.body) as Map<String, dynamic>;
      final api = LocalApi(name, config);
      final session = ViewerSession(
        api,
        deviceId,
        forceRelay: config['relayController'] == true,
      );
      await tester.pumpWidget(
        MaterialApp(
          locale: const Locale('es'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: ViewerScreen(
            api: api,
            device: RemoteDevice.fromJson({
              'id': deviceId,
              'name': 'Host de laboratorio',
              'platform': 'linux',
              'online': true,
              'remote': {'state': 'available'},
            }),
            password: 'contraseña-del-pc',
            sessionFactory: (a, id) => session,
          ),
        ),
      );
      try {
        await runLive(tester, () async {
          expect((await request('mobile/prepare/$name', {}))['ok'], true);
          await until(
            () =>
                (session.phase == ViewerPhase.connected ||
                session.phase == ViewerPhase.failed),
          );
          if (session.phase == ViewerPhase.failed) {
            throw StateError('runtime_failed_${session.failure?.code}');
          }
          await until(
            () =>
                session.contextImageCurrent &&
                session.inputAllowed &&
                session.renderer.videoWidth == 320 &&
                (session.stats.decodedFrames ?? 0) >= 2,
            () => jsonEncode({
              'phase': session.phase.name,
              'context': session.agentContext.state.name,
              'sequence': session.agentContext.sequence,
              'current': session.contextImageCurrent,
              'width': session.renderer.videoWidth,
              'height': session.renderer.videoHeight,
              'renderVideo': session.renderer.renderVideo,
              'textureReady': session.renderer.textureId != null,
              'trackKinds': session.renderer.srcObject
                  ?.getTracks()
                  .map((t) => '${t.kind}:${t.enabled}')
                  .toList(),
              'frames': session.stats.decodedFrames,
              'inputAllowed': session.inputAllowed,
            }),
          );
          expect(session.agentContext.enabled, true);
          expect(session.inputAllowed, true);
          expect(session.features.files, false);
          expect(session.features.clipboard, false);
          expect(session.features.audio, false);
          session.sendInputs([
            RemoteInput.button(0, down: true),
            RemoteInput.button(0, down: false),
            RemoteInput.key('KeyA', down: true),
            RemoteInput.key('KeyA', down: false),
          ]);
          final before = session.stats.decodedFrames!;
          await until(() => (session.stats.decodedFrames ?? 0) > before);
          if (name == 'correct') {
            final busy = await http
                .post(Uri.parse('$endpoint/signal/correct/busy'))
                .timeout(const Duration(seconds: 12));
            expect(busy.statusCode, 204);
          }
        });
        await tester.pump();
        late Map<String, dynamic> report;
        late int elapsed;
        late Map<String,dynamic> background;
        await runLive(tester, () async {
          expect(
            (await request(
              'mobile/screenshot/$name',
              {},
            ))['nativeGreenVerified'],
            true,
          );
          final stats = session.stats;
          expect(
            stats.localCandidateType,
            config['relayController'] == true
                ? 'relay'
                : isIn(['host', 'prflx', 'srflx']),
          );
          report = {
            'nativeGreenVerified': true,
            'challengeId': session.challengeId,
            'helloCount': session.challengeCount,
            'productionRuntime': true,
            'productionScreen': true,
            'authenticated': true,
            'decodedFrames': stats.decodedFrames,
            'width': session.renderer.videoWidth,
            'height': session.renderer.videoHeight,
            'inputSent': true,
            'extensionNegotiated': session.agentContext.enabled,
            'contextImageCurrent': session.contextImageCurrent,
            'sensitiveFeaturesFalse':
                !session.features.files &&
                !session.features.clipboard &&
                !session.features.audio,
            'candidates': {
              'local': stats.localCandidateType,
              'remote': stats.remoteCandidateType,
              'relayProtocol': stats.relayProtocol,
            },
          };
          final clock=MobileMonotonicClock();
          final left=clock.nowMicros(); expect(left,isNotNull);
          background=await request('mobile/background/$name',{});
          elapsed=clock.nowMicros()!-left!;
        });
        // Los callbacks de ciclo de vida pertenecen al binding de pruebas: avanzar
        // sus temporizadores no sustituye la pausa/reanudación real del SO anterior.
        await tester.pump(const Duration(milliseconds:300));
        await runLive(tester, () async {
          if(name=='correct') {
            await until(()=>session.phase==ViewerPhase.connected && session.inputAllowed, ()=>jsonEncode({'stage':'resume','phase':session.phase.name,'failure':session.failure?.code,'requests':api.requests,'keyPresent':session.hasKey}));
            if(api.requests==2) {
              expect(session.challengeId,isNot(report['challengeId']));
              session.sendInputs([
                RemoteInput.button(0,down:true),RemoteInput.button(0,down:false),
                RemoteInput.key('KeyA',down:true),RemoteInput.key('KeyA',down:false),
              ]);
              await until(()=>session.contextImageCurrent && (session.stats.decodedFrames??0)>=2);
              expect((await request('mobile/screenshot/correct-auto-reconnect',{}))['nativeGreenVerified'],true);
              report.addAll({'challengeId':session.challengeId,'helloCount':session.challengeCount,'decodedFrames':session.stats.decodedFrames,'width':session.renderer.videoWidth,'height':session.renderer.videoHeight,'candidates':{'local':session.stats.localCandidateType,'remote':session.stats.remoteCandidateType,'relayProtocol':session.stats.relayProtocol}});
            }
          } else {
            await until(()=>session.phase==ViewerPhase.closed);
            expect(session.hasKey,false);
          }
          report.addAll({
            'backgroundSeconds':background['seconds'],
            'backgroundElapsedMicros':elapsed,
            'backgroundRecovered':name=='correct' && session.connected,
            'backgroundClosed':name=='correct-reconnect' && session.phase==ViewerPhase.closed && !session.hasKey,
            'requestsAfterResume':api.requests,
          });
          await request('mobile/checkpoint/$name', report);
          await session.close();
          expect((await api.native!)['protectedIpc'], true);
          expect((await request('mobile/result/$name', report))['ok'], true);
        });
      } finally {
        await tester.runAsync(() async {
          await session.close();
          if (api.native != null) {
            try {
              await api.native!.timeout(const Duration(seconds: 90));
            } on Object catch (_) {}
          }
        });
        await tester.pumpWidget(const SizedBox.shrink());
        await tester.pump();
      }
    }, timeout: const Timeout(Duration(minutes: 2)));
  }
}
