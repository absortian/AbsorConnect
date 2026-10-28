import 'dart:convert';
import 'package:absor_connect/src/remote/video_stats.dart';
import 'package:absor_connect/src/remote/protocol.dart';
import 'package:absor_connect/src/remote/quality_selection.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';

List<StatsReport> report(double at, {Map<String, Object?> values = const {}, String id = 'v'}) => [
  StatsReport(id, 'inbound-rtp', at * 1000, {'kind': 'video', 'bytesReceived': at * 100, 'framesDecoded': at * 0.03, 'jitterBufferDelay': at * 0.0006, 'jitterBufferEmittedCount': at * 0.03, 'frameWidth': 1920, 'frameHeight': 1080, ...values}),
  StatsReport('a', 'inbound-rtp', at, {'kind': 'audio', 'framesPerSecond': 99, 'bytesReceived': 99999999}),
  StatsReport('t', 'transport', at, {'selectedCandidatePairId': 'p'}),
  StatsReport('p', 'candidate-pair', at, {'localCandidateId': 'l', 'currentRoundTripTime': 0.02}),
  StatsReport('l', 'local-candidate', at, {'candidateType': 'prflx', 'relayProtocol': 'tls'}),
];

void main() {
  test('solo negocia hosts capaces, espera confirmación y conserva preferencia al reconectar', () {
    final state = QualitySelection();
    expect(state.negotiate(false), isNull);
    expect(state.select(StreamProfile.smooth), isNull);
    expect(state.negotiate(true), isNull);
    expect(jsonDecode(state.select(StreamProfile.smooth)!), {'v': 1, 'type': 'set-stream-quality', 'profile': 'smooth'});
    expect(state.confirmed, StreamProfile.balanced);
    state.confirm(StreamProfile.smooth);
    expect(state.confirmed, StreamProfile.smooth);
    state.reset();
    expect(state.select(StreamProfile.native), isNull);
    expect(jsonDecode(state.negotiate(true)!)['profile'], 'smooth');
  });
  test('calcula deltas de vídeo, no audio, sin inventar la primera muestra', () {
    final sampler = VideoStatsSampler();
    final first = sampler.sample(report(1000));
    expect((first.fps, first.kbps, first.bufferMs), (null, null, null));
    final next = sampler.sample(report(2000));
    expect((next.decodedFrames, next.localCandidateType, next.relayProtocol), (60, 'prflx', 'tls'));
    expect((next.relay, next.rttMs, next.fps, next.width, next.height, next.kbps, next.bufferMs), (true, 20, 30, 1920, 1080, 800, 20));
  });
  test('reinicia contadores, flujo y timestamp sin valores falsos', () {
    final sampler = VideoStatsSampler();
    sampler.sample(report(2000));
    expect(sampler.sample(report(3000, values: {'bytesReceived': 1, 'framesDecoded': 1})).kbps, isNull);
    expect(sampler.sample(report(3000)).fps, isNull);
    expect(sampler.sample(report(4000, id: 'new')).kbps, isNull);
    sampler.reset();
    expect(sampler.sample(report(5000)).bufferMs, isNull);
  });
  test('descarta ausentes/no finitos; cero fps es válido', () {
    final sampler = VideoStatsSampler();
    final stats = sampler.sample(report(1000, values: {'framesPerSecond': 0, 'frameWidth': double.nan, 'bytesReceived': double.infinity, 'jitterBufferDelay': -1}));
    expect((stats.fps, stats.width, stats.height, stats.kbps), (0, null, null, null));
    expect(sampler.sample([]).relay, isNull);
    final unknown = report(2000);
    unknown.last.values['candidateType'] = 'not-a-type';
    unknown.last.values['relayProtocol'] = 'not-a-protocol';
    final bounded = sampler.sample(unknown);
    expect(bounded.localCandidateType, isNull);
    expect(bounded.relayProtocol, isNull);
  });
}
