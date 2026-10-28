import 'dart:async';

import 'package:absor_connect/src/api.dart';
import 'package:absor_connect/src/remote/remote_api.dart';
import 'package:absor_connect/src/remote/viewer_session.dart';
import 'package:absor_connect/src/session.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';

class UnavailableApi extends RemoteApi {
  UnavailableApi()
    : super(Session(ApiClient(baseUrl: 'https://example.invalid')));
  @override
  Future<List<Map<String, dynamic>>> iceServers() async =>
      throw ApiError('remote_unavailable', 503);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test('configura logs sin datos ICE antes de crear la textura y no crea un peer si la API falla', () async {
    const channel = MethodChannel('FlutterWebRTC.Method');
    final calls = <MethodCall>[];
    WebRTC.initialized = false;
    final messenger =
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    messenger.setMockMethodCallHandler(channel, (call) async {
      calls.add(call);
      if (call.method == 'createVideoRenderer') return {'textureId': 1};
      return null;
    });
    messenger.setMockMessageHandler(
      'FlutterWebRTC/Texture1',
      (message) async =>
          const StandardMethodCodec().encodeSuccessEnvelope(null),
    );
    final session = ViewerSession(
      UnavailableApi(),
      '12345678-1234-4abc-8def-123456789abc',
    );
    try {
      await session.connect('public-test-password');
      expect(session.phase, ViewerPhase.failed);
      expect(calls.first.method, 'initialize');
      expect(calls.first.arguments, {
        'options': {'logSeverity': 'error'},
      });
      expect(
        calls.indexWhere((c) => c.method == 'createVideoRenderer'),
        greaterThan(0),
      );
      expect(calls.any((c) => c.method == 'createPeerConnection'), isFalse);
    } finally {
      await session.dispose();
      messenger.setMockMethodCallHandler(channel, null);
      messenger.setMockMessageHandler('FlutterWebRTC/Texture1', null);
      WebRTC.initialized = false;
    }
  });
  test(
    'dispose espera al teardown pendiente antes de liberar la textura',
    () async {
      const channel = MethodChannel('FlutterWebRTC.Method');
      final calls = <String>[];
      final detaching = Completer<void>(), detached = Completer<void>();
      WebRTC.initialized = false;
      final messenger =
          TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
      messenger.setMockMethodCallHandler(channel, (call) async {
        calls.add(call.method);
        if (call.method == 'createVideoRenderer') return {'textureId': 2};
        if (call.method == 'videoRendererSetSrcObject') {
          if (!detaching.isCompleted) detaching.complete();
          await detached.future;
        }
        return null;
      });
      messenger.setMockMessageHandler(
        'FlutterWebRTC/Texture2',
        (message) async =>
            const StandardMethodCodec().encodeSuccessEnvelope(null),
      );
      final session = ViewerSession(
        UnavailableApi(),
        '12345678-1234-4abc-8def-123456789abc',
      );
      try {
        final connecting = session.connect('public-test-password');
        await detaching.future;
        final disposing = session.dispose();
        await Future<void>.delayed(const Duration(milliseconds: 250));
        expect(calls.where((m) => m == 'videoRendererSetSrcObject').length, 1);
        expect(calls, isNot(contains('videoRendererDispose')));
        detached.complete();
        await connecting;
        await disposing;
        expect(calls.last, 'videoRendererDispose');
      } finally {
        if (!detached.isCompleted) detached.complete();
        messenger.setMockMethodCallHandler(channel, null);
        messenger.setMockMessageHandler('FlutterWebRTC/Texture2', null);
        WebRTC.initialized = false;
      }
    },
  );
}
