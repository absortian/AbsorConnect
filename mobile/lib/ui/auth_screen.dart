import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../src/api.dart';
import '../src/services.dart';
import 'errors.dart';
import 'theme.dart';

/// Pantalla de acceso: sin sesión no se muestra ni se usa ninguna conexión.
class AuthScreen extends StatefulWidget {
  const AuthScreen({super.key});

  @override
  State<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends State<AuthScreen> {
  static const _minPasswordLength = 10;

  final _email = TextEditingController();
  final _password = TextEditingController();
  final _confirmation = TextEditingController();
  bool _register = false;
  bool _working = false;
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    _confirmation.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final t = AppLocalizations.of(context);
    // Comprobaciones locales: no gastan uno de los registros por hora que admite el servicio
    if (_register && _password.text.length < _minPasswordLength) {
      setState(() => _error = codeText(t, 'password_too_short'));
      return;
    }
    if (_register && _password.text != _confirmation.text) {
      setState(() => _error = codeText(t, 'password_mismatch'));
      return;
    }
    setState(() {
      _working = true;
      _error = null;
    });
    final session = AppServices.of(context).session;
    try {
      final email = _email.text.trim();
      if (_register) {
        await session.register(email, _password.text);
      } else {
        await session.login(email, _password.text);
      }
    } on ApiError catch (error) {
      if (mounted) setState(() => _error = codeText(t, error.code));
    } finally {
      if (mounted) setState(() => _working = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final expired = AppServices.of(context).session.expired;
    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(
          gradient: RadialGradient(center: Alignment(0, -1.1), radius: 1.2, colors: [Color(0x556366F1), AppColors.background]),
        ),
        child: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(24),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 420),
                child: AutofillGroup(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Center(child: ClipRRect(borderRadius: BorderRadius.circular(16), child: Image.asset('assets/icon.png', width: 72, height: 72))),
                      const SizedBox(height: 16),
                      Text(t.appTitle, textAlign: TextAlign.center, style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700)),
                      const SizedBox(height: 8),
                      Text(t.authSubtitle, textAlign: TextAlign.center, style: const TextStyle(color: AppColors.textSecondary)),
                      const SizedBox(height: 24),
                      SegmentedButton<bool>(
                        segments: [
                          ButtonSegment(value: false, label: Text(t.authLogin)),
                          ButtonSegment(value: true, label: Text(t.authRegister)),
                        ],
                        selected: {_register},
                        showSelectedIcon: false,
                        onSelectionChanged: (value) => setState(() {
                          _register = value.first;
                          _error = null;
                          _confirmation.clear();
                        }),
                      ),
                      const SizedBox(height: 20),
                      if (expired && _error == null) ...[
                        _Notice(text: t.authExpired),
                        const SizedBox(height: 16),
                      ],
                      TextField(
                        key: const Key('auth-email'),
                        controller: _email,
                        keyboardType: TextInputType.emailAddress,
                        autocorrect: false,
                        autofillHints: const [AutofillHints.email],
                        decoration: InputDecoration(labelText: t.authEmail),
                        textInputAction: TextInputAction.next,
                      ),
                      const SizedBox(height: 12),
                      TextField(
                        key: const Key('auth-password'),
                        controller: _password,
                        obscureText: true,
                        autofillHints: [_register ? AutofillHints.newPassword : AutofillHints.password],
                        decoration: InputDecoration(labelText: t.authPassword, helperText: _register ? t.authPasswordHint : null),
                        textInputAction: _register ? TextInputAction.next : TextInputAction.done,
                        onSubmitted: _register ? null : (_) => _submit(),
                      ),
                      if (_register) ...[
                        const SizedBox(height: 12),
                        TextField(
                          key: const Key('auth-confirmation'),
                          controller: _confirmation,
                          obscureText: true,
                          autofillHints: const [AutofillHints.newPassword],
                          decoration: InputDecoration(labelText: t.authConfirmPassword),
                          onSubmitted: (_) => _submit(),
                        ),
                      ],
                      if (_error != null) ...[
                        const SizedBox(height: 14),
                        Text(_error!, key: const Key('auth-error'), style: const TextStyle(color: AppColors.danger)),
                      ],
                      const SizedBox(height: 20),
                      FilledButton(
                        key: const Key('auth-submit'),
                        onPressed: _working ? null : _submit,
                        child: _working
                            ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                            : Text(_register ? t.authRegister : t.authLogin),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _Notice extends StatelessWidget {
  const _Notice({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: AppColors.warning.withValues(alpha: 0.1),
          border: Border.all(color: AppColors.warning.withValues(alpha: 0.25)),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Icon(Icons.warning_amber_rounded, color: AppColors.warning, size: 18),
          const SizedBox(width: 8),
          Expanded(child: Text(text, style: const TextStyle(color: AppColors.textSecondary, fontSize: 13))),
        ]),
      );
}
