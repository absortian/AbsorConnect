import 'protocol.dart';

/// La preferencia dura la sesión del visor; la capacidad se negocia de nuevo en cada conexión.
class QualitySelection {
  bool supported = false;
  StreamProfile confirmed = StreamProfile.balanced;
  StreamProfile? _desired;

  String? negotiate(bool capability) {
    supported = capability;
    return supported && _desired != null ? setStreamQualityMessage(_desired!) : null;
  }

  String? select(StreamProfile profile) {
    if (!supported) return null;
    _desired = profile;
    return setStreamQualityMessage(profile);
  }

  void confirm(StreamProfile profile) {
    if (supported) confirmed = profile;
  }

  void reset() => supported = false;
}
