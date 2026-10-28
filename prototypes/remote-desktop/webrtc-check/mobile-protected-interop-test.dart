// Copiar a integration_test/ de una copia aislada de mobile/. Plugin y mensajes
// de producción contra ventana propia X11 en VM. La API se señala por el broker;
// no recibe credenciales de cuenta/agente. Solo clic/KeyA completos de laboratorio.
import 'dart:async';
import 'dart:convert';

import 'package:absor_connect/src/remote/auth.dart';
import 'package:absor_connect/src/remote/input.dart';
import 'package:absor_connect/src/remote/agent_protocol.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:http/http.dart' as http;
import 'package:integration_test/integration_test.dart';

const endpoint = String.fromEnvironment(
  'ABSOR_NATIVE_LAB_URL',
  defaultValue: 'http://127.0.0.1:8793',
);
const password = 'contraseña-del-pc';

Future<Map<String, dynamic>> post(
  String path,
  Map<String, dynamic> body,
) async {
  final response = await http
      .post(
        Uri.parse('$endpoint/$path'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode(body),
      )
      .timeout(const Duration(seconds: 120));
  if (response.statusCode != 200) {
    throw StateError('Señalización local: ${response.statusCode}');
  }
  return jsonDecode(response.body) as Map<String, dynamic>;
}

int decoded(List<StatsReport> stats) {
  for (final item in stats) {
    if (item.type == 'inbound-rtp' &&
        (item.values['kind'] ?? item.values['mediaType']) == 'video') {
      return (item.values['framesDecoded'] as num?)?.toInt() ?? 0;
    }
  }
  return 0;
}

Map<String, dynamic> candidateTypes(List<StatsReport> stats) {
  final byId = {for (final item in stats) item.id: item};
  StatsReport? pair;
  for (final item in stats) {
    if (item.type == 'transport') {
      pair = byId[item.values['selectedCandidatePairId']] ?? pair;
    }
  }
  pair ??= stats
      .where(
        (item) =>
            item.type == 'candidate-pair' &&
            item.values['nominated'] == true &&
            item.values['state'] == 'succeeded',
      )
      .firstOrNull;
  return {
    'local': byId[pair?.values['localCandidateId']]?.values['candidateType'],
    'remote': byId[pair?.values['remoteCandidateId']]?.values['candidateType'],
    'relayProtocol':
        byId[pair?.values['localCandidateId']]?.values['relayProtocol'],
  };
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  for (final name in [
    'correct',
    'correct-reconnect',
    'wrong-proof',
    'fingerprint-mismatch',
  ]) {
    testWidgets('libwebrtc nativo ↔ Flutter móvil: $name', (tester) async {
      await WebRTC.initialize(options: {'logSeverity': 'error'});
      final renderer = RTCVideoRenderer();
      await renderer.initialize();
      await tester.pumpWidget(
        MaterialApp(home: Scaffold(body: RTCVideoView(renderer))),
      );
      await tester.runAsync(() async {
        final response = await http
            .get(Uri.parse('$endpoint/mobile/config'))
            .timeout(const Duration(seconds: 5));
        if (response.statusCode != 200) {
          throw StateError('Sin configuración del laboratorio');
        }
        final configuration = jsonDecode(response.body) as Map<String, dynamic>;
        final relay = configuration['relayController'] == true;
        expect(configuration['nativeFixture'], true);
        Future<Map<String, dynamic>>? nativeFuture;
        final pc = await createPeerConnection({
          'iceServers': configuration['iceServers'],
          'sdpSemantics': 'unified-plan',
          'continualGatheringPolicy': 'gather_once',
          if (relay) 'iceTransportPolicy': 'relay',
        });
        final auth = Completer<Map<String, dynamic>>();
        final gathered = Completer<void>();
        var relayCandidate = false;
        pc.onIceCandidate = (candidate) {
          if (candidate.candidate?.contains(' typ relay ') == true) {
            relayCandidate = true;
          }
        };
        final channel = await pc.createDataChannel(
          'control',
          RTCDataChannelInit(),
        );
        final input = await pc.createDataChannel('input', RTCDataChannelInit());
        final fixedInput = [
          RemoteInput.button(0, down: true),
          RemoteInput.button(0, down: false),
          RemoteInput.key('KeyA', down: true),
          RemoteInput.key('KeyA', down: false),
        ];
        var preAuthInputSent = false,
            inputSent = false,
            extensionNegotiated = false;
        var authenticated = false;
        String nonce = '';
        Object? protocolFailure;
        MediaStream? stream;
        var helloCount = 0;
        var offer = '', answer = '';
        pc.onTrack = (event) async {
          if (event.track.kind != 'video') return;
          stream =
              event.streams.firstOrNull ??
              await createLocalMediaStream('lab-video');
          if (event.streams.isEmpty) await stream!.addTrack(event.track);
          renderer.srcObject = stream;
        };
        pc.onIceGatheringState = (state) {
          if (state == RTCIceGatheringState.RTCIceGatheringStateComplete &&
              !gathered.isCompleted) {
            gathered.complete();
          }
        };
        channel.onMessage = (data) async {
          try {
            final message = jsonDecode(data.text) as Map<String, dynamic>;
            if (message['v'] != 1) throw StateError('Versión inesperada');
            if (message['type'] == 'hello') {
              if (++helloCount != 1 ||
                  message['salt'] is! String ||
                  message['iterations'] != 600000) {
                throw StateError('Reto inesperado');
              }
              if (decoded(await pc.getStats()) != 0) {
                throw StateError('Vídeo antes de autenticar');
              }
              nonce = message['nonce'] as String;
              final inputDeadline = DateTime.now().add(
                const Duration(seconds: 5),
              );
              while (input.state != RTCDataChannelState.RTCDataChannelOpen) {
                if (DateTime.now().isAfter(inputDeadline)) {
                  throw StateError('Canal de entrada no disponible');
                }
                await Future<void>.delayed(const Duration(milliseconds: 10));
              }
              for (final message in fixedInput) {
                await input.send(RTCDataChannelMessage(message));
              }
              preAuthInputSent = true;
              await Future<void>.delayed(const Duration(milliseconds: 200));
              expect(decoded(await pc.getStats()), 0);
              final key = await deriveKey(
                password,
                message['salt'] as String,
                600000,
              );
              var proof = computeProof(
                key,
                nonce: message['nonce'] as String,
                offerFingerprint:
                    '${name == 'fingerprint-mismatch' ? 'changed ' : ''}${sdpFingerprint(offer)!}',
                answerFingerprint: sdpFingerprint(answer)!,
              );
              if (name == 'wrong-proof') proof = List.filled(44, 'A').join();
              await channel.send(
                RTCDataChannelMessage(
                  jsonEncode({'v': 1, 'type': 'auth', 'proof': proof}),
                ),
              );
            } else if (message['type'] == 'auth-result' && !auth.isCompleted) {
              authenticated = message['ok'] == true;
              auth.complete(message);
            } else if (message['type'] == 'features') {
              expect(authenticated, true);
              expect(message['unattendedControl'], true);
              await channel.send(
                RTCDataChannelMessage(
                  jsonEncode(const AgentControlEnable().toJson()),
                ),
              );
            } else if (message['extension'] == 1) {
              expect(authenticated, true);
              final parsed = parseAgentHostMessage(data.text);
              expect(parsed, isNotNull);
              if (parsed is AgentCapabilitiesMessage) {
                expect(parsed.actions, isEmpty);
                expect(
                  parsed.capabilities.toJson().values.every((v) => v == false),
                  true,
                );
                extensionNegotiated = true;
              }
            } else {
              throw StateError('Mensaje nativo inesperado');
            }
          } on Object catch (error, stack) {
            protocolFailure = error;
            if (!auth.isCompleted) auth.completeError(error, stack);
          }
        };
        // El posible rechazo queda atendido mientras se intercambia SDP.
        unawaited(
          auth.future.then<void>((_) {}, onError: (Object _, StackTrace _) {}),
        );
        try {
          await pc.addTransceiver(
            kind: RTCRtpMediaType.RTCRtpMediaTypeVideo,
            init: RTCRtpTransceiverInit(
              direction: TransceiverDirection.RecvOnly,
            ),
          );
          await pc.setLocalDescription(await pc.createOffer());
          final gatheringDeadline = DateTime.now().add(
            const Duration(seconds: 25),
          );
          while (!gathered.isCompleted && !(relay && relayCandidate)) {
            if (DateTime.now().isAfter(gatheringDeadline)) {
              throw StateError('Venció la recopilación ICE');
            }
            await Future<void>.delayed(const Duration(milliseconds: 50));
          }
          if (relay) {
            await Future<void>.delayed(const Duration(milliseconds: 500));
          }
          offer = (await pc.getLocalDescription())!.sdp!;
          nativeFuture = post('protected/$name/run', {});
          unawaited(
            nativeFuture.then<void>(
              (_) {},
              onError: (Object _, StackTrace __) {},
            ),
          );
          answer =
              (await post('mobile/offer/$name', {'sdp': offer}))['sdp']
                  as String;
          await pc.setRemoteDescription(
            RTCSessionDescription(answer, 'answer'),
          );
          final result = await auth.future.timeout(const Duration(seconds: 20));
          final expected = name == 'correct' || name == 'correct-reconnect';
          expect(result['ok'], expected);
          if (!expected) expect(result['reason'], 'wrong_password');
          var frames = 0;
          final deadline = DateTime.now().add(
            Duration(seconds: expected ? 12 : 1),
          );
          while (DateTime.now().isBefore(deadline)) {
            frames = decoded(await pc.getStats());
            if (expected &&
                frames >= 2 &&
                renderer.videoWidth == 320 &&
                renderer.videoHeight == 180) {
              break;
            }
            if (!expected) expect(frames, 0);
            await Future<void>.delayed(const Duration(milliseconds: 50));
          }
          expect(frames, expected ? greaterThanOrEqualTo(2) : 0);
          if (expected) {
            expect(renderer.videoWidth, 320);
            expect(renderer.videoHeight, 180);
          }
          if (expected) {
            final deadline = DateTime.now().add(const Duration(seconds: 5));
            while (!extensionNegotiated) {
              if (protocolFailure != null) throw protocolFailure!;
              if (DateTime.now().isAfter(deadline)) {
                throw StateError('Extensión no negociada');
              }
              await Future<void>.delayed(const Duration(milliseconds: 10));
            }
            // Los mensajes reales de producción llevan v:1. Otros códigos/versiones se descartan.
            await input.send(
              RTCDataChannelMessage(RemoteInput.key('KeyB', down: true)),
            );
            await input.send(
              RTCDataChannelMessage(
                jsonEncode({
                  'v': 2,
                  'type': 'button',
                  'button': 0,
                  'down': true,
                }),
              ),
            );
            for (final message in fixedInput) {
              await input.send(RTCDataChannelMessage(message));
            }
            inputSent = true;
            await Future<void>.delayed(const Duration(seconds: 2));
            expect(decoded(await pc.getStats()), greaterThan(frames));
            frames = decoded(await pc.getStats());
            if (name == 'correct') {
              final busy = await http
                  .post(Uri.parse('$endpoint/signal/correct/busy'))
                  .timeout(const Duration(seconds: 12));
              expect(busy.statusCode, 204);
            }
          }
          if (protocolFailure != null) throw protocolFailure!;
          final candidates = candidateTypes(await pc.getStats());
          // El NAT del emulador puede descubrir un candidato peer-reflexive,
          // incluso sin servidores ICE. Sigue siendo directo, no un relé TURN.
          expect(
            candidates['local'],
            relay ? 'relay' : isIn(['host', 'prflx', 'srflx']),
          );
          if (!relay) {
            expect(candidates['remote'], isIn(['host', 'prflx', 'srflx']));
          }
          await channel.send(
            RTCDataChannelMessage(
              jsonEncode({'v': 1, 'type': 'bye', 'reason': 'closed'}),
            ),
          );
          final native = await nativeFuture;
          expect(native['protectedIpc'], true);
          final report = await post('mobile/result/$name', {
            'nonce': nonce,
            'preAuthInputSent': preAuthInputSent,
            'inputSent': inputSent,
            'extensionNegotiated': extensionNegotiated,
            'authenticated': result['ok'],
            'decodedFrames': frames,
            'helloCount': helloCount,
            'candidates': candidates,
            'width': renderer.videoWidth,
            'height': renderer.videoHeight,
          });
          expect(report['ok'], true);
          // ignore: avoid_print
          print('MOBILE_INTEROP ${jsonEncode(report)}');
        } finally {
          renderer.srcObject = null;
          await input.close();
          await channel.close();
          await pc.close();
          await stream?.dispose();
          if (nativeFuture != null) {
            try {
              await nativeFuture.timeout(const Duration(seconds: 90));
            } on Object catch (_) {}
          }
        }
      });
      await tester.pumpWidget(const SizedBox.shrink());
      await renderer.dispose();
    }, timeout: const Timeout(Duration(minutes: 2)));
  }
}
