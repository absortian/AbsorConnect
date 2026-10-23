// Ejecutar desde integration_test/ de la copia aislada de mobile/.
import 'dart:async';
import 'dart:convert';
import 'package:absor_connect/src/remote/auth.dart';
import 'package:absor_connect/src/remote/protocol.dart';
import 'package:absor_connect/src/remote/video_stats.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:http/http.dart' as http;
import 'package:integration_test/integration_test.dart';

const endpoint = 'http://127.0.0.1:8793';

Future<Map<String, dynamic>> post(String path, Map<String, dynamic> body) async {
  final response = await http.post(Uri.parse('$endpoint/$path'), headers: {'Content-Type': 'application/json'}, body: jsonEncode(body)).timeout(const Duration(seconds: 35));
  if (response.statusCode != 200) throw StateError('Señalización: ${response.statusCode}');
  return jsonDecode(response.body) as Map<String, dynamic>;
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('tres perfiles del codificador Chromium recibidos por Flutter', (tester) async {
    final renderer = RTCVideoRenderer();
    await renderer.initialize();
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: RTCVideoView(renderer))));
    await tester.runAsync(() async {
      final config = jsonDecode((await http.get(Uri.parse('$endpoint/config'))).body) as Map<String, dynamic>;
      final relay = config['relayController'] == true;
      final pc = await createPeerConnection({'iceServers': config['iceServers'], 'sdpSemantics': 'unified-plan', if (relay) 'iceTransportPolicy': 'relay'});
      final auth = Completer<void>(), features = Completer<void>(), gathered = Completer<void>();
      final confirms = <StreamProfile, Completer<void>>{};
      final results = <Map<String, dynamic>>[];
      String? offer, answer;
      final channel = await pc.createDataChannel('control', RTCDataChannelInit());
      pc.onIceGatheringState = (state) { if (state == RTCIceGatheringState.RTCIceGatheringStateComplete && !gathered.isCompleted) gathered.complete(); };
      pc.onTrack = (event) async {
        if (event.track.kind != 'video') return;
        final stream = event.streams.isNotEmpty ? event.streams.first : await createLocalMediaStream('quality-remote');
        if (event.streams.isEmpty) await stream.addTrack(event.track);
        renderer.srcObject = stream;
      };
      channel.onMessage = (raw) async {
        if (raw.isBinary) return;
        switch (parseHostMessage(raw.text)) {
          case HelloMessage(:final salt, :final iterations, :final nonce):
            final key = await deriveKey('contraseña-del-pc', salt, iterations);
            final proof = computeProof(key, nonce: nonce, offerFingerprint: sdpFingerprint(offer!)!, answerFingerprint: sdpFingerprint(answer!)!);
            await channel.send(RTCDataChannelMessage(authMessage(proof)));
          case AuthResultMessage(:final ok):
            if (!auth.isCompleted) { if (ok) { auth.complete(); } else { auth.completeError(StateError('Autenticación rechazada')); } }
          case FeaturesMessage(:final streamQuality):
            if (streamQuality && !features.isCompleted) features.complete();
          case StreamQualityMessage(:final profile):
            final done = confirms[profile];
            if (done != null && !done.isCompleted) done.complete();
          default: break;
        }
      };
      try {
        await pc.addTransceiver(kind: RTCRtpMediaType.RTCRtpMediaTypeVideo, init: RTCRtpTransceiverInit(direction: TransceiverDirection.RecvOnly));
        await pc.setLocalDescription(await pc.createOffer());
        await gathered.future.timeout(const Duration(seconds: 8), onTimeout: () {});
        offer = (await pc.getLocalDescription())!.sdp!;
        answer = (await post('offer/correct', {'sdp': offer}))['sdp'] as String;
        await pc.setRemoteDescription(RTCSessionDescription(answer, 'answer'));
        await auth.future.timeout(const Duration(seconds: 25));
        await features.future.timeout(const Duration(seconds: 10));
        for (final profile in [StreamProfile.native, StreamProfile.balanced, StreamProfile.smooth]) {
          final done = confirms[profile] = Completer<void>();
          await channel.send(RTCDataChannelMessage(setStreamQualityMessage(profile)));
          await done.future.timeout(const Duration(seconds: 10));
          await Future<void>.delayed(const Duration(seconds: 4));
          final sampler = VideoStatsSampler();
          final samples = <ViewerStats>[];
          for (var i = 0; i < 9; i++) {
            final stats = sampler.sample(await pc.getStats());
            if (i > 0) samples.add(stats);
            if (i < 8) await Future<void>.delayed(const Duration(seconds: 1));
          }
          final fps = samples.map((s) => s.fps).whereType<int>().toList();
          expect(fps, isNotEmpty);
          expect(fps.any((f) => f > 0), isTrue);
          final latest = samples.last;
          expect(latest.relay, relay);
          expect((latest.width ?? 0) > 0 && (latest.height ?? 0) > 0, isTrue);
          if (profile == StreamProfile.balanced) expect(latest.width! <= 1920 && latest.height! <= 1080, isTrue);
          if (profile == StreamProfile.smooth) expect(latest.width! <= 1280 && latest.height! <= 720, isTrue);
          results.add({'profile': profile.name, 'width': latest.width, 'height': latest.height, 'fps': fps.reduce((a,b) => a+b) / fps.length, 'kbps': latest.kbps, 'bufferMs': latest.bufferMs, 'relay': latest.relay});
        }
        await post('result/correct', {'ok': true, 'profiles': results});
      } finally {
        channel.onMessage = null;
        await pc.close();
        renderer.srcObject = null;
      }
    });
    await renderer.dispose();
  }, timeout: const Timeout(Duration(minutes: 5)));
}
