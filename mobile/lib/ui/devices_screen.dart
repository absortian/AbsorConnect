import 'dart:async';

import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../src/remote/remote_api.dart';
import '../src/services.dart';
import 'errors.dart';
import 'remote_texts.dart';
import 'theme.dart';
import 'viewer_screen.dart';

/// Los PCs de la cuenta y su estado, como la sección Equipos del escritorio (mobile-app). Se
/// actualiza cada 5 s mientras está abierta y solo deja conectar a los disponibles.
class DevicesScreen extends StatefulWidget {
  const DevicesScreen({super.key});

  @override
  State<DevicesScreen> createState() => _DevicesScreenState();
}

class _DevicesScreenState extends State<DevicesScreen> {
  static const _refreshEvery = Duration(seconds: 5);

  List<RemoteDevice>? _devices;
  Object? _error;
  Timer? _timer;
  late final RemoteApi _api = RemoteApi(AppServices.of(context).session);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _refresh());
    _timer = Timer.periodic(_refreshEvery, (_) => _refresh());
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _refresh() async {
    try {
      final devices = await _api.devices();
      // Primero los disponibles; dentro de cada grupo, por nombre
      devices.sort((a, b) => a.available != b.available ? (a.available ? -1 : 1) : a.name.toLowerCase().compareTo(b.name.toLowerCase()));
      if (!mounted) return;
      setState(() {
        _devices = devices;
        _error = null;
      });
    } on Object catch (error) {
      if (mounted) setState(() => _error = error);
    }
  }

  Future<void> _connect(RemoteDevice device) async {
    final password = await askPcPassword(context, device.name);
    if (password == null || !mounted) return;
    _timer?.cancel();
    await Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => ViewerScreen(api: _api, device: device, password: password)));
    if (!mounted) return;
    _timer = Timer.periodic(_refreshEvery, (_) => _refresh());
    await _refresh();
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final devices = _devices;
    return Scaffold(
      appBar: AppBar(title: Text(t.devicesTitle)),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: ListView(
          key: const Key('devices-list'),
          padding: const EdgeInsets.symmetric(vertical: 8),
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
              child: Text(t.devicesHint, style: const TextStyle(color: AppColors.textSecondary, fontSize: 13)),
            ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                child: Text(t.devicesLoadFailed(errorText(context, _error)), style: const TextStyle(color: AppColors.danger)),
              ),
            if (devices == null && _error == null) const Padding(padding: EdgeInsets.all(32), child: Center(child: CircularProgressIndicator())),
            if (devices != null && devices.isEmpty)
              Padding(
                padding: const EdgeInsets.all(32),
                child: Text(t.devicesEmpty, textAlign: TextAlign.center, style: const TextStyle(color: AppColors.textSecondary)),
              ),
            for (final device in devices ?? const <RemoteDevice>[])
              ListTile(
                key: Key('device-${device.id}'),
                leading: Icon(_platformIcon(device.platform), color: device.available ? AppColors.accentSoft : AppColors.textMuted),
                title: Text(device.name, maxLines: 1, overflow: TextOverflow.ellipsis),
                subtitle: Text(
                  '${_platformName(device.platform)} · ${RemoteTexts.deviceState(t, device.state)}',
                  style: TextStyle(color: device.available ? AppColors.success : AppColors.textSecondary, fontSize: 12),
                ),
                trailing: FilledButton(
                  key: Key('connect-${device.id}'),
                  style: FilledButton.styleFrom(minimumSize: const Size(0, 38)),
                  onPressed: device.available ? () => _connect(device) : null,
                  child: Text(t.remoteConnect),
                ),
              ),
          ],
        ),
      ),
    );
  }

  static IconData _platformIcon(String platform) => switch (platform) {
        'windows' => Icons.desktop_windows_outlined,
        'macos' => Icons.laptop_mac_outlined,
        _ => Icons.computer_outlined,
      };

  static String _platformName(String platform) => switch (platform) {
        'windows' => 'Windows',
        'macos' => 'macOS',
        'linux' => 'Linux',
        _ => platform,
      };
}

/// Pide la contraseña de control remoto del PC (no se guarda: solo se usa para derivar K).
Future<String?> askPcPassword(BuildContext context, String pcName) {
  final t = AppLocalizations.of(context);
  final controller = TextEditingController();
  return showDialog<String>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(t.remotePasswordTitle(pcName)),
      content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(t.remotePasswordHint, style: const TextStyle(color: AppColors.textSecondary, fontSize: 13)),
        const SizedBox(height: 12),
        TextField(
          key: const Key('pc-password'),
          controller: controller,
          autofocus: true,
          obscureText: true,
          enableSuggestions: false,
          autocorrect: false,
          decoration: InputDecoration(labelText: t.remotePassword),
          onSubmitted: (value) => Navigator.pop(context, value.isEmpty ? null : value),
        ),
      ]),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: Text(t.cancel)),
        FilledButton(
          key: const Key('pc-password-connect'),
          onPressed: () => Navigator.pop(context, controller.text.isEmpty ? null : controller.text),
          child: Text(t.remoteConnect),
        ),
      ],
    ),
  );
}
