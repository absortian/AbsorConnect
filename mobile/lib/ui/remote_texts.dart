import '../l10n/app_localizations.dart';

/// Textos del control remoto por código, los mismos fallos que el visor de escritorio
/// (remote-desktop-viewer, "Fallos comprensibles").
abstract final class RemoteTexts {
  static String deviceState(AppLocalizations t, String state) => switch (state) {
        'available' => t.deviceStateAvailable,
        'busy' => t.deviceStateBusy,
        'missing_permissions' => t.deviceStateMissingPermissions,
        'unsupported' => t.deviceStateUnsupported,
        'offline' => t.deviceStateOffline,
        _ => t.deviceStateDisabled,
      };

  static String error(AppLocalizations t, String code, [int? retryAfter]) => switch (code) {
        'wrong_password' => t.remoteErrWrongPassword,
        'locked' => t.remoteErrLocked(retryAfter == null ? '?' : '${(retryAfter / 60).ceil().clamp(1, 1 << 30)}'),
        'busy' => t.remoteErrBusy,
        'device_offline' => t.remoteErrDeviceOffline,
        'remote_disabled' => t.remoteErrRemoteDisabled,
        'missing_permissions' => t.remoteErrMissingPermissions,
        'unsupported' => t.remoteErrUnsupported,
        'declined' => t.remoteErrDeclined,
        'connection_failed' => t.remoteErrConnectionFailed,
        'no_answer' => t.remoteErrNoAnswer,
        'reconnect_failed' => t.remoteErrReconnectFailed,
        'too_many_requests' => t.remoteErrTooManyRequests('${retryAfter ?? 60}'),
        'remote_unavailable' => t.remoteErrUnavailable,
        'device_not_found' => t.remoteErrDeviceNotFound,
        'network_error' => t.err_network_error,
        _ => t.remoteErrOther(code),
      };

  static String closedBy(AppLocalizations t, String? reason) => switch (reason) {
        'local' => t.remoteClosedLocal,
        'disabled' => t.remoteClosedDisabled,
        'password_changed' => t.remoteClosedPasswordChanged,
        'signed_out' => t.remoteClosedSignedOut,
        'stopped' => t.remoteClosedStopped,
        'capture_failed' => t.remoteClosedCaptureFailed,
        'background' => t.remoteClosedBackground,
        _ => t.remoteClosedOther,
      };

  static String transferError(AppLocalizations t, String? code) => switch (code) {
        'disabled' => t.remoteTransferErrDisabled,
        'not_found' => t.remoteTransferErrNotFound,
        'denied' => t.remoteTransferErrDenied,
        'is_directory' => t.remoteTransferErrIsDirectory,
        'io' => t.remoteTransferErrIo,
        'busy' => t.remoteTransferErrBusy,
        'integrity' => t.remoteTransferErrIntegrity,
        'size' => t.remoteTransferErrSize,
        'connection_lost' => t.remoteTransferErrConnectionLost,
        'read' => t.remoteTransferErrRead,
        _ => t.remoteTransferErrOther(code ?? '?'),
      };
}
