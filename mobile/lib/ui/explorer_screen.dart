import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

import '../l10n/app_localizations.dart';
import '../src/connections.dart';
import '../src/remote_fs.dart';
import '../src/services.dart';
import '../src/transfers.dart';
import 'errors.dart';
import 'home_screen.dart';
import 'terminal_screen.dart';
import 'theme.dart';
import 'transfers_bar.dart';

/// Explorador de una conexión SFTP o S3: navegar, subir, descargar y compartir, crear
/// carpetas y borrar.
class ExplorerScreen extends StatefulWidget {
  const ExplorerScreen({super.key, required this.connection});

  final Entry connection;

  @override
  State<ExplorerScreen> createState() => _ExplorerScreenState();
}

class _ExplorerScreenState extends State<ExplorerScreen> {
  late final RemoteFs _fs;
  String? _initialPath;
  String? _path;
  List<RemoteItem>? _items;
  Object? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      final services = AppServices.of(context);
      _fs = widget.connection.isSsh ? SftpFs(services.ssh, widget.connection) : S3Fs(widget.connection);
      try {
        _initialPath = await _fs.initialPath();
        await _open(_initialPath!);
      } on Object catch (error) {
        if (mounted) {
          setState(() {
            _error = error;
            _loading = false;
          });
        }
      }
    });
  }

  Future<void> _open(String path) async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final items = await _fs.list(path);
      if (!mounted) return;
      setState(() {
        _path = path;
        _items = items;
        _loading = false;
      });
    } on Object catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error;
        _loading = false;
      });
    }
  }

  Future<void> _refresh() async {
    final path = _path;
    if (path != null) await _open(path);
  }

  Future<void> _download(RemoteItem item) async {
    final transfers = AppServices.of(context).transfers;
    final dir = Directory('${(await getTemporaryDirectory()).path}/downloads');
    await dir.create(recursive: true);
    final target = File('${dir.path}/${item.name}');
    final result = await transfers.run(item.name, upload: false, task: (progress) async {
      await _fs.download(item, target, progress);
      return target;
    });
    if (result.status == TransferStatus.done && mounted) {
      await SharePlus.instance.share(ShareParams(files: [XFile(target.path)]));
    }
  }

  Future<void> _upload({required bool photos}) async {
    final path = _path;
    if (path == null) return;
    final files = await FilePicker.pickFiles(type: photos ? FileType.media : FileType.any);
    if (files.isEmpty || !mounted) return;
    final transfers = AppServices.of(context).transfers;
    await Future.wait([
      for (final file in files)
        () async {
          final length = await file.length() ?? 0;
          await transfers.run(file.name, upload: true, task: (progress) async {
            await _fs.upload(path, UploadSource(file.name, length, file.readAsByteStream), progress);
            return null;
          });
        }(),
    ]);
    if (mounted && _path == path) await _refresh();
  }

  Future<void> _mkdir() async {
    final t = AppLocalizations.of(context);
    final path = _path;
    if (path == null) return;
    final name = await askText(context, t.newRemoteFolder, t.folderName);
    if (name == null) return;
    try {
      await _fs.mkdir(path, name);
      await _refresh();
    } on Object catch (error) {
      _showError(error);
    }
  }

  Future<void> _delete(RemoteItem item) async {
    final t = AppLocalizations.of(context);
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(t.deleteItemConfirm(item.name)),
        content: Text(item.isDirectory ? t.deleteItemFolderBody : t.deleteItemBody),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: Text(t.cancel)),
          FilledButton(
            key: const Key('confirm-delete'),
            style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
            onPressed: () => Navigator.pop(context, true),
            child: Text(t.delete),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await _fs.delete(item);
      await _refresh();
    } on Object catch (error) {
      _showError(error);
    }
  }

  void _showError(Object error) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(context, error))));
  }

  void _itemActions(RemoteItem item) {
    final t = AppLocalizations.of(context);
    showModalBottomSheet<void>(
      context: context,
      builder: (sheet) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          ListTile(title: Text(item.name, style: const TextStyle(fontWeight: FontWeight.w600)), subtitle: item.size == null ? null : Text(_size(item.size!))),
          if (!item.isDirectory)
            ListTile(
              key: const Key('item-download'),
              leading: const Icon(Icons.download),
              title: Text(t.download),
              onTap: () {
                Navigator.pop(sheet);
                _download(item);
              },
            ),
          ListTile(
            key: const Key('item-delete'),
            leading: const Icon(Icons.delete_outline, color: AppColors.danger),
            title: Text(t.delete, style: const TextStyle(color: AppColors.danger)),
            onTap: () {
              Navigator.pop(sheet);
              _delete(item);
            },
          ),
        ]),
      ),
    );
  }

  static String _size(int bytes) {
    if (bytes < 1024) return '$bytes B';
    const units = ['KB', 'MB', 'GB', 'TB'];
    var value = bytes / 1024;
    var unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit++;
    }
    return '${value.toStringAsFixed(value < 10 ? 1 : 0)} ${units[unit]}';
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final path = _path;
    final parent = path == null ? null : _fs.parent(path);
    final canWrite = path != null && _fs.canWrite(path);
    final date = DateFormat.yMd(Localizations.localeOf(context).toLanguageTag()).add_Hm();
    return PopScope(
      // El botón Atrás sube de carpeta mientras se esté por debajo de la carpeta inicial;
      // desde ella (o la raíz) sale del explorador. ".." permite subir más arriba.
      canPop: parent == null || path == _initialPath,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop && parent != null) _open(parent);
      },
      child: Scaffold(
        appBar: AppBar(
          title: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(widget.connection.name),
            if (path != null)
              Text(_fsLabel(path), key: const Key('explorer-path'), style: const TextStyle(fontSize: 12, color: AppColors.textMuted), overflow: TextOverflow.ellipsis),
          ]),
          actions: [
            if (widget.connection.isSsh)
              IconButton(
                tooltip: t.openTerminal,
                icon: const Icon(Icons.terminal),
                onPressed: () {
                  final session = AppServices.of(context).terminals.open(widget.connection);
                  Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => TerminalScreen(session: session)));
                },
              ),
            if (canWrite) IconButton(key: const Key('explorer-mkdir'), tooltip: t.newRemoteFolder, icon: const Icon(Icons.create_new_folder_outlined), onPressed: _mkdir),
            IconButton(tooltip: t.refresh, icon: const Icon(Icons.refresh), onPressed: _loading ? null : _refresh),
          ],
        ),
        floatingActionButton: canWrite
            ? FloatingActionButton.extended(
                key: const Key('explorer-upload'),
                icon: const Icon(Icons.upload),
                label: Text(t.upload),
                onPressed: () => showModalBottomSheet<void>(
                  context: context,
                  builder: (sheet) => SafeArea(
                    child: Column(mainAxisSize: MainAxisSize.min, children: [
                      ListTile(leading: const Icon(Icons.folder_open), title: Text(t.uploadFromFiles), onTap: () {
                        Navigator.pop(sheet);
                        _upload(photos: false);
                      }),
                      ListTile(leading: const Icon(Icons.photo_library_outlined), title: Text(t.uploadFromPhotos), onTap: () {
                        Navigator.pop(sheet);
                        _upload(photos: true);
                      }),
                    ]),
                  ),
                ),
              )
            : null,
        bottomNavigationBar: const TransfersBar(),
        body: _body(context, t, parent, date),
      ),
    );
  }

  String _fsLabel(String path) => _fs.label(path);

  Widget _body(BuildContext context, AppLocalizations t, String? parent, DateFormat date) {
    final items = _items;
    if (_error != null && items == null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            const Icon(Icons.error_outline, size: 40, color: AppColors.danger),
            const SizedBox(height: 12),
            Text(errorText(context, _error), key: const Key('explorer-error'), textAlign: TextAlign.center),
            const SizedBox(height: 16),
            FilledButton(onPressed: () => Navigator.of(context).pop(), child: Text(t.cancel)),
          ]),
        ),
      );
    }
    if (items == null) return const Center(child: CircularProgressIndicator());
    return RefreshIndicator(
      onRefresh: _refresh,
      child: ListView(
        padding: const EdgeInsets.only(bottom: 96),
        children: [
          if (_loading) const LinearProgressIndicator(minHeight: 2),
          if (_error != null)
            Padding(padding: const EdgeInsets.all(16), child: Text(errorText(context, _error), style: const TextStyle(color: AppColors.danger))),
          if (parent != null)
            ListTile(leading: const Icon(Icons.arrow_upward, color: AppColors.textMuted), title: const Text('..'), onTap: () => _open(parent)),
          if (items.isEmpty) Padding(padding: const EdgeInsets.all(32), child: Text(t.emptyFolder, textAlign: TextAlign.center, style: const TextStyle(color: AppColors.textMuted))),
          for (final item in items)
            ListTile(
              key: Key('item-${item.name}'),
              leading: Icon(
                _path == '' ? Icons.inventory_2_outlined : (item.isDirectory ? Icons.folder : Icons.insert_drive_file_outlined),
                color: item.isDirectory ? AppColors.folder : AppColors.textSecondary,
              ),
              title: Text(item.name, maxLines: 1, overflow: TextOverflow.ellipsis),
              subtitle: item.isDirectory
                  ? null
                  : Text(
                      [if (item.size != null) _size(item.size!), if (item.modified != null) date.format(item.modified!.toLocal())].join(' · '),
                      style: const TextStyle(color: AppColors.textMuted, fontSize: 12),
                    ),
              onTap: () => item.isDirectory ? _open(item.path) : _itemActions(item),
              onLongPress: _path == '' ? null : () => _itemActions(item),
              trailing: _path == '' ? null : IconButton(key: Key('item-menu-${item.name}'), icon: const Icon(Icons.more_vert), onPressed: () => _itemActions(item)),
            ),
        ],
      ),
    );
  }
}
