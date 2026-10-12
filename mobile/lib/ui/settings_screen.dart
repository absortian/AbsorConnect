import 'dart:io';

import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../l10n/app_localizations.dart';
import '../src/services.dart';
import '../src/updates.dart';
import 'theme.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  String _version = '';
  bool _checking = false;
  String? _updateMessage;
  AvailableUpdate? _update;

  @override
  void initState() {
    super.initState();
    PackageInfo.fromPlatform().then((info) {
      if (mounted) setState(() => _version = info.version);
    });
  }

  Future<void> _checkUpdates() async {
    final t = AppLocalizations.of(context);
    setState(() => _checking = true);
    final update = await UpdateChecker.check();
    if (!mounted) return;
    setState(() {
      _checking = false;
      _update = update;
      _updateMessage = update == null ? t.upToDate : t.updateAvailable(update.version);
    });
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final session = AppServices.of(context).session;
    return Scaffold(
      appBar: AppBar(title: Text(t.settings)),
      body: ListView(children: [
        ListTile(
          leading: const Icon(Icons.account_circle_outlined),
          title: Text(t.signedInAs),
          subtitle: Text(session.email ?? '', key: const Key('settings-email'), style: const TextStyle(color: AppColors.textSecondary)),
        ),
        ListTile(
          key: const Key('settings-logout'),
          leading: const Icon(Icons.logout),
          title: Text(t.logout),
          onTap: () async {
            Navigator.of(context).popUntil((route) => route.isFirst);
            await session.logout();
          },
        ),
        const Divider(),
        ListTile(leading: const Icon(Icons.info_outline), title: Text(t.version(_version))),
        if (Platform.isAndroid) ...[
          ListTile(
            leading: _checking ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.system_update),
            title: Text(t.checkUpdates),
            subtitle: _updateMessage == null ? null : Text(_updateMessage!),
            onTap: _checking ? null : _checkUpdates,
            trailing: _update == null
                ? null
                : TextButton(onPressed: () => launchUrl(Uri.parse(_update!.apkUrl), mode: LaunchMode.externalApplication), child: Text(t.updateDownload)),
          ),
        ],
        ListTile(
          leading: const Icon(Icons.public),
          title: Text(t.website),
          subtitle: const Text('absorconnect.absor.top', style: TextStyle(color: AppColors.textSecondary)),
          onTap: () => launchUrl(Uri.parse('https://absorconnect.absor.top'), mode: LaunchMode.externalApplication),
        ),
      ]),
    );
  }
}
