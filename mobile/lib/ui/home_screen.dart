import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../l10n/app_localizations.dart';
import '../src/connections.dart';
import '../src/services.dart';
import '../src/updates.dart';
import 'connection_form.dart';
import 'errors.dart';
import 'explorer_screen.dart';
import 'key_import.dart';
import 'settings_screen.dart';
import 'terminal_screen.dart';
import 'theme.dart';

/// Lista de conexiones de la cuenta, con sus carpetas.
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final Set<String> _expanded = {};
  AvailableUpdate? _update;
  Object? _loadError;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
    UpdateChecker.check().then((update) {
      if (mounted) setState(() => _update = update);
    });
  }

  Future<void> _load() async {
    try {
      await AppServices.of(context).connections.load();
      if (mounted) setState(() => _loadError = null);
    } on Object catch (error) {
      if (mounted) setState(() => _loadError = error);
    }
  }

  /// Ejecuta un cambio en la lista y avisa si no se pudo guardar.
  Future<void> _change(Future<void> Function() action) async {
    final t = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await action();
    } on ConnectionsConflict {
      messenger.showSnackBar(SnackBar(content: Text(t.connectionsConflict), duration: const Duration(seconds: 6)));
    } on Object catch (error) {
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(content: Text(t.saveFailed(errorText(context, error)))));
    }
  }

  Future<void> _newFolder() async {
    final t = AppLocalizations.of(context);
    final name = await _askText(context, t.addFolder, t.folderName);
    if (name == null || !mounted) return;
    final connections = AppServices.of(context).connections;
    await _change(() => connections.upsert(Entry({'id': newUuid(), 'name': name, 'isFolder': true, 'parentId': null})));
  }

  Future<void> _delete(Entry entry) async {
    final t = AppLocalizations.of(context);
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(t.deleteConnectionConfirm(entry.name)),
        content: Text(entry.isFolder ? t.deleteFolderConfirm : t.deleteConnectionBody),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: Text(t.cancel)),
          FilledButton(style: FilledButton.styleFrom(backgroundColor: AppColors.danger), onPressed: () => Navigator.pop(context, true), child: Text(t.delete)),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    final services = AppServices.of(context);
    await _change(() => services.connections.remove(entry.id));
    if (!entry.isFolder) await services.keys.delete(entry.id);
  }

  Future<void> _move(Entry entry) async {
    final t = AppLocalizations.of(context);
    final connections = AppServices.of(context).connections;
    final target = await showModalBottomSheet<String>(
      context: context,
      builder: (context) => SafeArea(
        child: ListView(shrinkWrap: true, children: [
          ListTile(title: Text(t.moveTo, style: const TextStyle(fontWeight: FontWeight.w600))),
          ListTile(leading: const Icon(Icons.home_outlined), title: Text(t.root), onTap: () => Navigator.pop(context, '')),
          for (final folder in connections.folders)
            if (folder.id != entry.id) ListTile(leading: const Icon(Icons.folder_outlined), title: Text(folder.name), onTap: () => Navigator.pop(context, folder.id)),
        ]),
      ),
    );
    if (target == null) return;
    await _change(() => connections.move(entry.id, target.isEmpty ? null : target));
  }

  Future<void> _open(Entry entry, {bool terminal = false}) async {
    if (!await ensurePrivateKey(context, entry) || !mounted) return;
    final services = AppServices.of(context);
    if (terminal) {
      final session = services.terminals.open(entry);
      await Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => TerminalScreen(session: session)));
    } else {
      await Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => ExplorerScreen(connection: entry)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final services = AppServices.of(context);
    return Scaffold(
      appBar: AppBar(
        title: Row(children: [
          ClipRRect(borderRadius: BorderRadius.circular(6), child: Image.asset('assets/icon.png', width: 26, height: 26)),
          const SizedBox(width: 10),
          Text(t.connectionsTitle),
        ]),
        actions: [
          ListenableBuilder(
            listenable: services.terminals,
            builder: (context, _) => IconButton(
              key: const Key('open-terminals'),
              tooltip: t.terminals,
              icon: Badge(
                isLabelVisible: services.terminals.sessions.isNotEmpty,
                label: Text('${services.terminals.sessions.length}'),
                child: const Icon(Icons.terminal),
              ),
              onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const TerminalsScreen())),
            ),
          ),
          IconButton(
            key: const Key('open-settings'),
            tooltip: t.settings,
            icon: const Icon(Icons.settings_outlined),
            onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const SettingsScreen())),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        key: const Key('add'),
        onPressed: () => showModalBottomSheet<void>(
          context: context,
          builder: (sheet) => SafeArea(
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              ListTile(
                key: const Key('add-connection'),
                leading: const Icon(Icons.add_link),
                title: Text(t.addConnection),
                onTap: () {
                  Navigator.pop(sheet);
                  Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const ConnectionForm()));
                },
              ),
              ListTile(
                key: const Key('add-folder'),
                leading: const Icon(Icons.create_new_folder_outlined),
                title: Text(t.addFolder),
                onTap: () {
                  Navigator.pop(sheet);
                  _newFolder();
                },
              ),
            ]),
          ),
        ),
        child: const Icon(Icons.add),
      ),
      body: ListenableBuilder(
        listenable: services.connections,
        builder: (context, _) {
          final store = services.connections;
          if (!store.loaded) {
            if (_loadError == null) return const Center(child: CircularProgressIndicator());
            return _Centered(
              icon: Icons.cloud_off,
              text: t.loadFailed(errorText(context, _loadError)),
              action: FilledButton(onPressed: _load, child: Text(t.retry)),
            );
          }
          final rows = <Widget>[
            if (_update != null) _UpdateBanner(update: _update!),
            if (store.entries.any((e) => e.credentialsUnavailable)) _Hint(text: t.credentialsUnavailable),
          ];
          void addLevel(String? parentId, int depth) {
            final children = store.childrenOf(parentId)
              ..sort((a, b) {
                if (a.isFolder != b.isFolder) return a.isFolder ? -1 : 1;
                return 0; // conserva el orden de la lista, como el escritorio
              });
            for (final entry in children) {
              rows.add(_EntryTile(
                entry: entry,
                depth: depth,
                expanded: _expanded.contains(entry.id),
                onTap: () {
                  if (entry.isFolder) {
                    setState(() => _expanded.contains(entry.id) ? _expanded.remove(entry.id) : _expanded.add(entry.id));
                  } else {
                    _open(entry);
                  }
                },
                onAction: (action) => switch (action) {
                  _Action.files => _open(entry),
                  _Action.terminal => _open(entry, terminal: true),
                  _Action.edit => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => ConnectionForm(editing: entry))),
                  _Action.move => _move(entry),
                  _Action.delete => _delete(entry),
                },
              ));
              if (entry.isFolder && _expanded.contains(entry.id)) addLevel(entry.id, depth + 1);
            }
          }

          addLevel(null, 0);
          return RefreshIndicator(
            onRefresh: _load,
            child: store.entries.isEmpty
                ? ListView(children: [...rows, _Centered(icon: Icons.dns_outlined, text: '${t.connectionsEmpty}\n${t.connectionsEmptyHint}')])
                : ListView(padding: const EdgeInsets.only(bottom: 96), children: rows),
          );
        },
      ),
    );
  }
}

enum _Action { files, terminal, edit, move, delete }

class _EntryTile extends StatelessWidget {
  const _EntryTile({required this.entry, required this.depth, required this.expanded, required this.onTap, required this.onAction});

  final Entry entry;
  final int depth;
  final bool expanded;
  final VoidCallback onTap;
  final void Function(_Action) onAction;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final subtitle = entry.isFolder
        ? null
        : entry.isSsh
            ? '${entry.str('username')}@${entry.str('host')}'
            : entry.str('endpoint').replaceFirst(RegExp(r'^https?://'), '');
    return ListTile(
      key: Key('entry-${entry.name}'),
      contentPadding: EdgeInsets.only(left: 16.0 + depth * 20, right: 4),
      leading: Icon(
        entry.isFolder ? (expanded ? Icons.folder_open : Icons.folder) : (entry.isSsh ? Icons.dns_outlined : Icons.cloud_outlined),
        color: entry.isFolder ? AppColors.folder : AppColors.accentSoft,
      ),
      title: Row(children: [
        Flexible(child: Text(entry.name, overflow: TextOverflow.ellipsis)),
        if (entry.credentialsUnavailable) ...[
          const SizedBox(width: 6),
          Tooltip(message: t.credentialsUnavailable, child: const Icon(Icons.warning_amber_rounded, size: 16, color: AppColors.warning)),
        ],
      ]),
      subtitle: subtitle == null ? null : Text(subtitle, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: AppColors.textMuted)),
      onTap: onTap,
      trailing: PopupMenuButton<_Action>(
        key: Key('menu-${entry.name}'),
        onSelected: onAction,
        itemBuilder: (context) => [
          if (!entry.isFolder) PopupMenuItem(value: _Action.files, child: Text(t.openFiles)),
          if (entry.isSsh) PopupMenuItem(value: _Action.terminal, child: Text(t.openTerminal)),
          if (!entry.isFolder) PopupMenuItem(value: _Action.edit, child: Text(t.edit)),
          PopupMenuItem(value: _Action.move, child: Text(t.moveTo)),
          PopupMenuItem(value: _Action.delete, child: Text(t.delete, style: const TextStyle(color: AppColors.danger))),
        ],
      ),
    );
  }
}

class _UpdateBanner extends StatelessWidget {
  const _UpdateBanner({required this.update});

  final AvailableUpdate update;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    return Container(
      key: const Key('update-banner'),
      margin: const EdgeInsets.fromLTRB(12, 12, 12, 0),
      padding: const EdgeInsets.fromLTRB(14, 8, 8, 8),
      decoration: BoxDecoration(color: AppColors.accent.withValues(alpha: 0.14), borderRadius: BorderRadius.circular(10)),
      child: Row(children: [
        const Icon(Icons.system_update, color: AppColors.accentSoft),
        const SizedBox(width: 10),
        Expanded(child: Text(t.updateAvailable(update.version))),
        TextButton(onPressed: () => launchUrl(Uri.parse(update.apkUrl), mode: LaunchMode.externalApplication), child: Text(t.updateDownload)),
      ]),
    );
  }
}

class _Hint extends StatelessWidget {
  const _Hint({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) => Container(
        margin: const EdgeInsets.fromLTRB(12, 12, 12, 0),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(color: AppColors.warning.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(10)),
        child: Text(text, style: const TextStyle(fontSize: 13, color: AppColors.textSecondary)),
      );
}

class _Centered extends StatelessWidget {
  const _Centered({required this.icon, required this.text, this.action});

  final IconData icon;
  final String text;
  final Widget? action;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(32, 96, 32, 32),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Icon(icon, size: 40, color: AppColors.textMuted),
          const SizedBox(height: 16),
          Text(text, textAlign: TextAlign.center, style: const TextStyle(color: AppColors.textSecondary, height: 1.5)),
          if (action != null) ...[const SizedBox(height: 16), action!],
        ]),
      );
}

/// Pide un texto en un diálogo (nombre de carpeta…).
Future<String?> _askText(BuildContext context, String title, String label) {
  final controller = TextEditingController();
  final t = AppLocalizations.of(context);
  return showDialog<String>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(title),
      content: TextField(key: const Key('ask-text'), controller: controller, autofocus: true, decoration: InputDecoration(labelText: label)),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: Text(t.cancel)),
        FilledButton(
          key: const Key('ask-ok'),
          onPressed: () => controller.text.trim().isEmpty ? null : Navigator.pop(context, controller.text.trim()),
          child: Text(t.save),
        ),
      ],
    ),
  );
}

Future<String?> askText(BuildContext context, String title, String label) => _askText(context, title, label);

/// Conexión por clave privada sin clave en este dispositivo: se pide importarla antes de
/// conectar. Devuelve false si se cancela o la clave no vale.
Future<bool> ensurePrivateKey(BuildContext context, Entry entry) async {
  if (!entry.isSsh || entry.str('authMethod') != 'privateKey') return true;
  final services = AppServices.of(context);
  if (await services.keys.read(entry.id) != null) return true;
  if (!context.mounted) return false;
  final t = AppLocalizations.of(context);
  final import = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(t.keyMissingTitle),
      content: Text(t.keyMissingBody(entry.str('privateKeyPath').split(RegExp(r'[\\/]')).last)),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context, false), child: Text(t.cancel)),
        FilledButton(onPressed: () => Navigator.pop(context, true), child: Text(t.importKey)),
      ],
    ),
  );
  if (import != true) return false;
  try {
    final picked = await pickPrivateKey(entry.str('passphrase'));
    if (picked == null) return false;
    await services.keys.write(entry.id, picked.pem);
    return true;
  } on FormatException {
    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(t.keyInvalid)));
    return false;
  }
}
