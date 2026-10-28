import 'package:flutter_webrtc/flutter_webrtc.dart';

class ViewerStats {
  const ViewerStats({this.relay, this.rttMs, this.fps, this.width, this.height, this.kbps, this.bufferMs, this.decodedFrames, this.localCandidateType, this.remoteCandidateType, this.relayProtocol});
  final bool? relay;
  /// Contadores y enums; nunca direcciones, SDP o credenciales ICE.
  final int? decodedFrames;
  final String? localCandidateType, remoteCandidateType, relayProtocol;
  final int? rttMs;
  final int? fps;
  final int? width;
  final int? height;
  final int? kbps;
  /// Tiempo medio en el búfer de vídeo durante el intervalo; no mide la entrada.
  final int? bufferMs;
}

double? _number(Object? value) => value is num && value.isFinite && value >= 0 ? value.toDouble() : null;
int? _round(double? value) => value != null && value.isFinite && value >= 0 ? value.round() : null;

/// Mismos contadores y unidades que el visor de escritorio. Solo vive en memoria.
class VideoStatsSampler {
  ({String id, double at, double? bytes, double? frames, double? delay, double? emitted})? _previous;

  void reset() => _previous = null;

  ViewerStats sample(List<StatsReport> reports) {
    final byId = {for (final r in reports) r.id: r};
    StatsReport? pair, video;
    for (final r in reports) {
      if (r.type == 'transport' && r.values['selectedCandidatePairId'] is String) pair = byId[r.values['selectedCandidatePairId']];
      if (r.type == 'inbound-rtp' && (r.values['kind'] ?? r.values['mediaType']) == 'video' && r.values['isRemote'] != true) video ??= r;
    }
    pair ??= reports.where((r) => r.type == 'candidate-pair' && r.values['state'] == 'succeeded' && r.values['nominated'] == true).firstOrNull;
    final local = pair == null ? null : byId[pair.values['localCandidateId']];
    final remote = pair == null ? null : byId[pair.values['remoteCandidateId']];
    final relay = pair == null ? null : local?.values['candidateType'] == 'relay' || remote?.values['candidateType'] == 'relay' || local?.values['relayProtocol'] is String;
    final rtt = _number(pair?.values['currentRoundTripTime']);
    String? candidate(Object? value) => {'host', 'prflx', 'srflx', 'relay'}.contains(value) ? value as String : null;
    final localType = candidate(local?.values['candidateType']), remoteType = candidate(remote?.values['candidateType']);
    final protocolValue = local?.values['relayProtocol'];
    final protocol = {'udp', 'tcp', 'tls'}.contains(protocolValue) ? protocolValue as String : null;
    if (video == null) {
      reset();
      return ViewerStats(relay: relay, rttMs: _round(rtt == null ? null : rtt * 1000), localCandidateType: localType, remoteCandidateType: remoteType, relayProtocol: protocol);
    }
    final values = video.values;
    // flutter_webrtc nativo entrega timestamp_us en Android y Darwin.
    final current = (id: video.id, at: video.timestamp / 1000, bytes: _number(values['bytesReceived']), frames: _number(values['framesDecoded']), delay: _number(values['jitterBufferDelay']), emitted: _number(values['jitterBufferEmittedCount']));
    final previous = _previous;
    final elapsed = previous?.id == current.id ? current.at - previous!.at : 0.0;
    double? delta(double? before, double? after) => elapsed > 0 && elapsed.isFinite && before != null && after != null && after >= before ? after - before : null;
    final bytes = delta(previous?.bytes, current.bytes), frames = delta(previous?.frames, current.frames);
    final delay = delta(previous?.delay, current.delay), emitted = delta(previous?.emitted, current.emitted);
    final fps = _number(values['framesPerSecond']) ?? (frames == null ? null : frames * 1000 / elapsed);
    final width = _round(_number(values['frameWidth'])), height = _round(_number(values['frameHeight']));
    _previous = current;
    return ViewerStats(
      relay: relay,
      decodedFrames: _round(current.frames),
      localCandidateType: localType, remoteCandidateType: remoteType, relayProtocol: protocol,
      rttMs: _round(rtt == null ? null : rtt * 1000),
      fps: _round(fps),
      width: width != null && width > 0 && height != null && height > 0 ? width : null,
      height: width != null && width > 0 && height != null && height > 0 ? height : null,
      kbps: _round(bytes == null ? null : bytes * 8 / elapsed),
      bufferMs: _round(delay == null || emitted == null || emitted <= 0 ? null : delay * 1000 / emitted),
    );
  }
}
