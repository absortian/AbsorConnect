import 'dart:async';

import 'package:absor_connect/src/api.dart';
import 'package:absor_connect/src/session.dart';
import 'package:absor_connect/src/remote/remote_api.dart';
import 'package:absor_connect/src/remote/viewer_session.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';

class PendingIce extends RemoteApi {
  PendingIce() : super(Session(ApiClient(baseUrl: 'https://example.invalid')));
  final ice = Completer<List<Map<String, dynamic>>>();
  @override
  Future<List<Map<String, dynamic>>> iceServers() => ice.future;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  const channel = MethodChannel('FlutterWebRTC.Method');
  test(
    'cerrar durante inicialización no crea PC ni cambia a conectado después',
    () async {
      WebRTC.initialized = false;
      final initialize = Completer<void>();
      final calls = <String>[];
      messenger.setMockMethodCallHandler(channel, (call) async {
        calls.add(call.method);
        if (call.method == 'initialize') return initialize.future;
        throw StateError('unexpected_native_call');
      });
      final s = ViewerSession(
        PendingIce(),
        '12345678-1234-4abc-8def-123456789abc',
      );
      final connecting = s.connect('prueba');
      await Future<void>.delayed(const Duration(milliseconds: 10));
      final closing = s.close();
      await Future<void>.delayed(const Duration(milliseconds: 250));
      await closing;
      initialize.complete();
      await Future<void>.delayed(const Duration(milliseconds: 10));
      await connecting;
      expect(s.phase, ViewerPhase.closed);
      expect(calls, ['initialize']);
      expect(s.hasKey, false);
      await s.dispose();
      messenger.setMockMethodCallHandler(channel, null);
    },
  );
  for (final failTexture in [false, true]) {
    test(
      'dispose espera la negociación cancelada antes de liberar textura (fallo: $failTexture)',
      () async {
        WebRTC.initialized = false;
        final calls = <String>[];
        messenger.setMockMethodCallHandler(channel, (call) async {
          calls.add(call.method);
          if (failTexture && call.method == 'videoRendererSetSrcObject') {
            throw PlatformException(code: 'texture_gone');
          }
          return call.method == 'createVideoRenderer' ? {'textureId': 7} : null;
        });
        const texture = MethodChannel('FlutterWebRTC/Texture7');
        messenger.setMockMethodCallHandler(texture, (_) async => null);
        final api = PendingIce();
        final s = ViewerSession(api, '12345678-1234-4abc-8def-123456789abc');
        final connecting = s.connect('prueba');
        await Future<void>.delayed(const Duration(milliseconds: 10));
        expect(calls, contains('createVideoRenderer'));
        final disposal = s.dispose();
        await Future<void>.delayed(const Duration(milliseconds: 250));
        expect(calls, isNot(contains('videoRendererDispose')));
        var done = false;
        disposal.then((_) => done = true);
        api.ice.complete([]);
        for (var i = 0; i < 30 && !done; i++) {
          await Future<void>.delayed(const Duration(milliseconds: 10));
        }
        expect(done, true);
        await connecting;
        await disposal;
        expect(calls, isNot(contains('createPeerConnection')));
        expect(calls.last, 'videoRendererDispose');
        messenger.setMockMethodCallHandler(channel, null);
        messenger.setMockMethodCallHandler(texture, null);
      },
    );
  }
}
