import 'package:flutter/widgets.dart';

import '../l10n/app_localizations.dart';
import '../src/api.dart';
import '../src/s3.dart';
import '../src/ssh.dart';

/// Mensaje para la persona a partir de cualquier error de la API, de SSH o de S3.
String errorText(BuildContext context, Object? error) {
  final t = AppLocalizations.of(context);
  if (error is ApiError) return codeText(t, error.code);
  if (error is SshError) return codeText(t, error.code, error.detail);
  if (error is S3Error) {
    final text = codeText(t, error.code, error.detail);
    // "Sin conexión" no basta para saber qué pasó (DNS, puerto, tiempo de espera…)
    return error.code == 'network_error' && error.detail != null ? '$text\n${error.detail}' : text;
  }
  if (error == null) return t.err_unknown;
  // Error inesperado: se muestra su texto para poder diagnosticarlo
  final detail = error.toString();
  return '${t.err_unknown}\n${detail.length > 300 ? '${detail.substring(0, 300)}…' : detail}';
}

String codeText(AppLocalizations t, String code, [String? detail]) => switch (code) {
      'invalid_credentials' => t.err_invalid_credentials,
      'email_taken' => t.err_email_taken,
      'email_invalid' => t.err_email_invalid,
      'password_too_short' => t.err_password_too_short,
      'password_too_long' => t.err_password_too_long,
      'password_mismatch' => t.err_password_mismatch,
      'too_many_attempts' => t.err_too_many_attempts,
      'network_error' => t.err_network_error,
      'server_error' || 'http_error' => t.err_server_error,
      'connections_invalid' => t.err_connections_invalid,
      'ssh_auth_failed' => t.err_ssh_auth_failed,
      'ssh_unreachable' => t.err_ssh_unreachable,
      'ssh_timeout' => t.err_ssh_timeout,
      'ssh_key_missing' => t.err_ssh_key_missing,
      'ssh_key_invalid' => t.err_ssh_key_invalid,
      'ssh_disconnected' || 'ssh_error' => t.err_ssh_disconnected,
      'sftp_error' => t.err_sftp_error(detail ?? ''),
      's3_access_denied' => t.err_s3_access_denied,
      's3_not_found' => t.err_s3_not_found,
      's3_error' || 's3_bad_response' => t.err_s3_error(detail ?? ''),
      's3_redirect' => t.err_s3_redirect(detail ?? ''),
      's3_tls_error' => t.err_s3_tls_error(detail ?? ''),
      's3_invalid_endpoint' => t.err_s3_invalid_endpoint,
      _ => t.err_unknown,
    };
