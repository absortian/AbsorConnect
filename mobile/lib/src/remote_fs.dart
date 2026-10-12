import 'dart:io';

import 'package:dartssh2/dartssh2.dart';

import 'connections.dart';
import 's3.dart';
import 'ssh.dart';

/// Un elemento del listado remoto (carpeta, fichero o bucket).
class RemoteItem {
  RemoteItem({required this.name, required this.path, required this.isDirectory, this.size, this.modified});

  final String name;
  final String path;
  final bool isDirectory;
  final int? size;
  final DateTime? modified;
}

typedef Progress = void Function(int done, int? total);

/// Contenido que se sube: un stream de bytes y su tamaño (los ficheros del selector del
/// sistema pueden no tener ruta local, p. ej. `content://` en Android).
class UploadSource {
  UploadSource(this.name, this.length, this.open);

  final String name;
  final int length;
  final Stream<List<int>> Function() open;
}

/// Lo que necesita el explorador, igual para SFTP y para S3.
abstract class RemoteFs {
  /// Ruta con la que se abre el explorador.
  Future<String> initialPath();

  /// Ruta de la carpeta que contiene [path], o null si ya es la raíz.
  String? parent(String path);

  /// Texto que se muestra para la ruta actual.
  String label(String path);

  /// Si en esta ruta se pueden subir ficheros y crear carpetas (en S3 no en la lista de buckets).
  bool canWrite(String path);

  Future<List<RemoteItem>> list(String path);
  Future<void> mkdir(String path, String name);
  Future<void> delete(RemoteItem item);
  Future<void> download(RemoteItem item, File target, Progress onProgress);
  Future<void> upload(String path, UploadSource source, Progress onProgress);
}

/// SFTP sobre la conexión compartida del [SshPool].
class SftpFs implements RemoteFs {
  SftpFs(this.pool, this.connection);

  final SshPool pool;
  final Entry connection;

  Future<SftpClient> _sftp() async {
    try {
      return await pool.sftp(connection);
    } on Object catch (error) {
      throw toSshError(error);
    }
  }

  static String _join(String dir, String name) => dir.endsWith('/') ? '$dir$name' : '$dir/$name';

  @override
  Future<String> initialPath() async {
    final sftp = await _sftp();
    try {
      final initial = connection.str('initialPath').trim();
      final home = await sftp.absolute('.');
      if (initial.isEmpty) return home;
      if (initial == '~') return home;
      if (initial.startsWith('~/')) return _join(home, initial.substring(2));
      return await sftp.absolute(initial);
    } on Object catch (error) {
      throw toSshError(error);
    }
  }

  @override
  String? parent(String path) {
    if (path == '/' || path.isEmpty) return null;
    final index = path.lastIndexOf('/');
    return index <= 0 ? '/' : path.substring(0, index);
  }

  @override
  String label(String path) => '${connection.str('username')}@${connection.str('host')}:$path';

  @override
  bool canWrite(String path) => true;

  @override
  Future<List<RemoteItem>> list(String path) async {
    final sftp = await _sftp();
    try {
      final names = await sftp.listdir(path);
      final items = <RemoteItem>[];
      for (final entry in names) {
        if (entry.filename == '.' || entry.filename == '..') continue;
        var isDirectory = entry.attr.isDirectory;
        if (entry.attr.isSymbolicLink) {
          try {
            isDirectory = (await sftp.stat(_join(path, entry.filename))).isDirectory;
          } on Object {
            isDirectory = false; // enlace roto
          }
        }
        final mtime = entry.attr.modifyTime;
        items.add(RemoteItem(
          name: entry.filename,
          path: _join(path, entry.filename),
          isDirectory: isDirectory,
          size: isDirectory ? null : entry.attr.size,
          modified: mtime == null ? null : DateTime.fromMillisecondsSinceEpoch(mtime * 1000),
        ));
      }
      return sortItems(items);
    } on Object catch (error) {
      throw toSshError(error);
    }
  }

  @override
  Future<void> mkdir(String path, String name) async {
    final sftp = await _sftp();
    try {
      await sftp.mkdir(_join(path, name));
    } on Object catch (error) {
      throw toSshError(error);
    }
  }

  @override
  Future<void> delete(RemoteItem item) async {
    final sftp = await _sftp();
    try {
      await _deleteRecursive(sftp, item.path, item.isDirectory);
    } on Object catch (error) {
      throw toSshError(error);
    }
  }

  Future<void> _deleteRecursive(SftpClient sftp, String path, bool isDirectory) async {
    if (!isDirectory) return sftp.remove(path);
    for (final entry in await sftp.listdir(path)) {
      if (entry.filename == '.' || entry.filename == '..') continue;
      // Los enlaces simbólicos se borran como ficheros: nunca se sigue su destino
      await _deleteRecursive(sftp, _join(path, entry.filename), entry.attr.isDirectory && !entry.attr.isSymbolicLink);
    }
    await sftp.rmdir(path);
  }

  @override
  Future<void> download(RemoteItem item, File target, Progress onProgress) async {
    final sftp = await _sftp();
    SftpFile? file;
    IOSink? sink;
    try {
      file = await sftp.open(item.path);
      final total = item.size ?? (await file.stat()).size;
      sink = target.openWrite();
      var done = 0;
      await for (final chunk in file.read()) {
        sink.add(chunk);
        done += chunk.length;
        onProgress(done, total);
      }
      await sink.flush();
    } on Object catch (error) {
      throw toSshError(error);
    } finally {
      await sink?.close();
      await file?.close();
    }
  }

  @override
  Future<void> upload(String path, UploadSource source, Progress onProgress) async {
    final sftp = await _sftp();
    SftpFile? file;
    try {
      file = await sftp.open(
        _join(path, source.name),
        mode: SftpFileOpenMode.create | SftpFileOpenMode.truncate | SftpFileOpenMode.write,
      );
      await file.write(asBytes(source.open()), onProgress: (done) => onProgress(done, source.length)).done;
    } on Object catch (error) {
      throw toSshError(error);
    } finally {
      await file?.close();
    }
  }
}

/// S3 con el cliente propio. Ruta "" = lista de buckets; "bucket/prefijo/" dentro.
class S3Fs implements RemoteFs {
  S3Fs(this.connection) : client = S3Client.fromConnection(connection);

  final Entry connection;
  final S3Client client;

  static (String bucket, String prefix) _split(String path) {
    final index = path.indexOf('/');
    return index < 0 ? (path, '') : (path.substring(0, index), path.substring(index + 1));
  }

  @override
  Future<String> initialPath() async {
    final bucket = connection.str('bucket').trim();
    return bucket.isEmpty ? '' : '$bucket/';
  }

  @override
  String? parent(String path) {
    if (path.isEmpty) return null;
    final trimmed = path.endsWith('/') ? path.substring(0, path.length - 1) : path;
    final index = trimmed.lastIndexOf('/');
    return index < 0 ? '' : trimmed.substring(0, index + 1);
  }

  @override
  String label(String path) => path.isEmpty ? connection.name : 's3://$path';

  @override
  bool canWrite(String path) => path.isNotEmpty;

  @override
  Future<List<RemoteItem>> list(String path) async {
    if (path.isEmpty) {
      final buckets = await client.listBuckets();
      return [for (final b in buckets) RemoteItem(name: b, path: '$b/', isDirectory: true)];
    }
    final (bucket, prefix) = _split(path);
    final listing = await client.listObjects(bucket, prefix);
    return sortItems([
      for (final folder in listing.folders)
        RemoteItem(name: folder.substring(prefix.length).replaceAll(RegExp(r'/$'), ''), path: '$bucket/$folder', isDirectory: true),
      for (final object in listing.objects)
        if (object.key != prefix)
          RemoteItem(
            name: object.key.substring(prefix.length),
            path: '$bucket/${object.key}',
            isDirectory: false,
            size: object.size,
            modified: object.lastModified,
          ),
    ]);
  }

  @override
  Future<void> mkdir(String path, String name) {
    final (bucket, prefix) = _split(path);
    return client.putEmpty(bucket, '$prefix$name/');
  }

  @override
  Future<void> delete(RemoteItem item) {
    final (bucket, key) = _split(item.path);
    return item.isDirectory ? client.deletePrefix(bucket, key) : client.deleteObject(bucket, key);
  }

  @override
  Future<void> download(RemoteItem item, File target, Progress onProgress) {
    final (bucket, key) = _split(item.path);
    return client.getObject(bucket, key, target, onProgress);
  }

  @override
  Future<void> upload(String path, UploadSource source, Progress onProgress) {
    final (bucket, prefix) = _split(path);
    return client.putObject(bucket, '$prefix${source.name}', source.open(), source.length, onProgress);
  }
}

/// Carpetas primero y luego ficheros, por nombre sin distinguir mayúsculas.
List<RemoteItem> sortItems(List<RemoteItem> items) => items
  ..sort((a, b) {
    if (a.isDirectory != b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.toLowerCase().compareTo(b.name.toLowerCase());
  });
