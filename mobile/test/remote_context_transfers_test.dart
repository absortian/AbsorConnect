import 'dart:async';
import 'dart:convert';

import 'package:absor_connect/src/api.dart';
import 'package:absor_connect/src/session.dart';
import 'package:absor_connect/src/remote/agent_protocol.dart';
import 'package:absor_connect/src/remote/agent_viewer_state.dart';
import 'package:absor_connect/src/remote/protocol.dart';
import 'package:absor_connect/src/remote/remote_api.dart';
import 'package:absor_connect/src/remote/remote_transfers.dart';
import 'package:absor_connect/src/remote/viewer_session.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';

class FixtureSession extends ViewerSession {
  FixtureSession()
    : super(
        RemoteApi(Session(ApiClient(baseUrl: 'https://example.invalid'))),
        '12345678-1234-4abc-8def-123456789abc',
      ) {
    features = const FeaturesMessage(
      clipboard: true,
      files: true,
      audio: false,
    );
  }
  final sent = <String>[];
  int epoch = 0;
  AgentViewerStatus status = AgentViewerState().status;
  @override
  int get contextEpoch => epoch;
  @override
  AgentViewerStatus get agentContext => status;
  @override
  void sendControl(String message) => sent.add(message);
  Completer<bool>? room;
  @override
  Future<bool> controlRoom() async => room == null ? true : room!.future;
  void protect() {
    epoch++;
    status = const AgentViewerStatus(
      enabled: true,
      sequence: 2,
      state: AgentContext.login,
      imageAvailable: true,
      inputAllowed: true,
      sensitiveAllowed: false,
    );
    features = const FeaturesMessage(
      clipboard: false,
      files: false,
      audio: false,
    );
    onContextBoundary?.call();
  }
}

class FixtureChannel extends RTCDataChannel {
  final sent = <RTCDataChannelMessage>[];
  int amount = 0;
  @override
  RTCDataChannelState get state => RTCDataChannelState.RTCDataChannelOpen;
  @override
  int get id => 1;
  @override
  String get label => 'file';
  @override
  int get bufferedAmount => amount;
  @override
  Future<int> getBufferedAmount() async => amount;
  @override
  Future<void> send(RTCDataChannelMessage message) async {
    sent.add(message);
    if (!message.isBinary && jsonDecode(message.text)['type'] == 'file-offer') {
      scheduleMicrotask(
        () => onMessage?.call(
          RTCDataChannelMessage(
            jsonEncode({
              'type': 'file-accept',
              'id': jsonDecode(message.text)['id'],
            }),
          ),
        ),
      );
    }
  }

  @override
  Future<void> close() async {}
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  tearDown(
    () => messenger.setMockMethodCallHandler(SystemChannels.platform, null),
  );
  test(
    'descarta una lectura de portapapeles que responde después del cambio',
    () async {
      final s = FixtureSession();
      final t = RemoteTransfers(s);
      final read = Completer<Object?>();
      messenger.setMockMethodCallHandler(
        SystemChannels.platform,
        (call) async => call.method == 'Clipboard.getData' ? read.future : null,
      );
      final pending = t.sendClipboard();
      s.protect();
      read.complete({'text': 'contenido ficticio anterior'});
      expect(await pending, false);
      expect(s.sent, isEmpty);
      t.dispose();
      await s.dispose();
    },
  );
  test(
    'descarta portapapeles en espera de buffer y limpia callbacks al disponer',
    () async {
      final s = FixtureSession()..room = Completer<bool>();
      final t = RemoteTransfers(s);
      messenger.setMockMethodCallHandler(
        SystemChannels.platform,
        (call) async => {'text': 'dato ficticio'},
      );
      final pending = t.sendClipboard();
      await Future<void>.delayed(Duration.zero);
      s.protect();
      s.room!.complete(true);
      expect(await pending, false);
      expect(s.sent, isEmpty);
      t.dispose();
      expect(s.onClipboard, isNull);
      expect(s.onFileChannel, isNull);
      expect(s.onContextBoundary, isNull);
      await s.dispose();
    },
  );
  test('la carpeta pendiente se descarta y el contexto protegido no abre solicitudes nuevas', () async {
    final s = FixtureSession();
    final t = RemoteTransfers(s);
    final channel = FixtureChannel();
    s.onFileChannel!(channel);
    final listing = t.list('/anterior');
    s.protect();
    expect(await listing, isNull);
    expect(await t.list('/nuevo'), isNull);
    final download = await t.download('/nuevo', 'x', 1);
    expect(download.status, RemoteTransferStatus.failed);
    t.upload([
      (name: 'x', size: 1, open: () => Stream.value([1])),
    ]);
    expect(channel.sent.length, 1);
    expect(t.transfers, isEmpty);
    t.dispose();
    await s.dispose();
  });
  test(
    'corta fichero con buffer lleno y cola sin esperar una señal del canal',
    () async {
      final s = FixtureSession();
      final t = RemoteTransfers(s);
      final channel = FixtureChannel()..amount = 2 * 1024 * 1024;
      s.onFileChannel!(channel);
      t.upload([
        (name: 'a', size: 1, open: () => Stream.value([1])),
        (name: 'b', size: 1, open: () => Stream.value([2])),
      ]);
      await Future<void>.delayed(const Duration(milliseconds: 40));
      expect(channel.sent.length, 1);
      s.protect();
      await Future<void>.delayed(const Duration(milliseconds: 40));
      expect(channel.sent.length, 1);
      expect(t.transfers, isEmpty);
      t.dispose();
      await s.dispose();
    },
  );
}
