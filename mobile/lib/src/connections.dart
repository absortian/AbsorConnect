import 'dart:async';
import 'dart:math';

import 'package:flutter/foundation.dart';

import 'api.dart';
import 'session.dart';

/// Una entrada de la lista (conexión S3, conexión SSH o carpeta) en el mismo formato
/// JSON que la app de escritorio. Se guarda como mapa para conservar los campos que
/// esta app no conoce, igual que `normalizeEntry`.
class Entry {
  Entry(Map<String, dynamic> data) : data = Map<String, dynamic>.of(data);

  final Map<String, dynamic> data;

  String get id => data['id'] as String;
  String get name => (data['name'] as String?) ?? '';
  String? get parentId {
    final value = data['parentId'];
    return value is String && value.isNotEmpty ? value : null;
  }

  bool get isFolder => data['isFolder'] == true;
  bool get isSsh => !isFolder && data['type'] == 'ssh';
  bool get isS3 => !isFolder && !isSsh;
  bool get credentialsUnavailable => data['credentialsUnavailable'] == true;

  String str(String key) => (data[key] as String?) ?? '';

  Entry copyWith(Map<String, dynamic> changes) => Entry({...data, ...changes});
}

/// El servicio rechazó el guardado porque otro equipo guardó antes. La lista ya está
/// recargada con la versión actual.
class ConnectionsConflict implements Exception {}

/// Conexiones de la cuenta: caché en memoria de la última lista recibida y guardado de
/// la lista entera con control de revisión (como el escritorio).
class ConnectionsStore extends ChangeNotifier {
  ConnectionsStore(this.session) {
    session.addSignOutListener(clear);
  }

  static const _refreshAfter = Duration(seconds: 30);

  final Session session;

  int? _revision;
  List<Entry> _entries = const [];
  DateTime? _lastRead;
  // Lecturas y escrituras en fila: dos guardados seguidos deben usar cada uno la revisión
  // que dejó el anterior, o el segundo chocaría consigo mismo con un 409
  Future<void> _queue = Future.value();
  int _generation = 0;

  bool get loaded => _revision != null;
  List<Entry> get entries => _entries;

  Entry? byId(String id) {
    for (final entry in _entries) {
      if (entry.id == id) return entry;
    }
    return null;
  }

  List<Entry> childrenOf(String? parentId) => _entries.where((e) => e.parentId == parentId).toList();

  List<Entry> get folders => _entries.where((e) => e.isFolder).toList();

  Future<T> _serialized<T>(Future<T> Function() task) {
    final run = _queue.then((_) => task(), onError: (_) => task());
    _queue = run.then((_) {}, onError: (_) {});
    return run;
  }

  void _remember(Map<String, dynamic> snapshot, int since) {
    if (since != _generation) throw ApiError('unauthenticated', 401);
    _revision = snapshot['revision'] as int;
    _entries = (snapshot['entries'] as List).map((e) => Entry(e as Map<String, dynamic>)).toList();
    _lastRead = DateTime.now();
    notifyListeners();
  }

  Future<void> load() => _serialized(() async {
        final since = _generation;
        _remember(await session.request('GET', '/api/connections') as Map<String, dynamic>, since);
      });

  /// Al volver a la app: si la última lectura tiene más de 30 s, se relee.
  Future<void> refreshIfStale() async {
    final last = _lastRead;
    if (!session.isSignedIn || last == null || DateTime.now().difference(last) < _refreshAfter) return;
    try {
      await load();
    } on ApiError {
      // sin servicio: se reintentará; un 401 ya lo gestiona la sesión
    }
  }

  /// Guarda la lista entera. Si otro equipo guardó antes, lanza [ConnectionsConflict]
  /// con la lista ya recargada.
  Future<void> save(List<Entry> entries) => _serialized(() async {
        final since = _generation;
        if (_revision == null) {
          _remember(await session.request('GET', '/api/connections') as Map<String, dynamic>, since);
        }
        try {
          final result = await session.request('PUT', '/api/connections', body: {
            'revision': _revision,
            'entries': entries.map((e) => e.data).toList(),
          });
          _remember(result as Map<String, dynamic>, since);
        } on ApiError catch (error) {
          final body = error.body;
          if (error.code == 'connections_conflict' && body is Map<String, dynamic>) {
            _remember(body, since);
            throw ConnectionsConflict();
          }
          rethrow;
        }
      });

  Future<void> upsert(Entry entry) {
    final exists = _entries.any((e) => e.id == entry.id);
    return save(exists ? [for (final e in _entries) e.id == entry.id ? entry : e] : [..._entries, entry]);
  }

  /// Borra la entrada y, si es una carpeta, todo lo que contiene.
  Future<void> remove(String id) {
    final doomed = <String>{id};
    var grew = true;
    while (grew) {
      grew = false;
      for (final entry in _entries) {
        if (!doomed.contains(entry.id) && entry.parentId != null && doomed.contains(entry.parentId)) {
          doomed.add(entry.id);
          grew = true;
        }
      }
    }
    return save(_entries.where((e) => !doomed.contains(e.id)).toList());
  }

  /// Mueve a una carpeta (o a la raíz con null), evitando meter una carpeta dentro de sí misma.
  Future<void> move(String id, String? parentId) {
    for (String? current = parentId; current != null; current = byId(current)?.parentId) {
      if (current == id) return Future.value();
    }
    return save([for (final e in _entries) e.id == id ? e.copyWith({'parentId': parentId}) : e]);
  }

  void clear() {
    _generation++;
    _revision = null;
    _entries = const [];
    _lastRead = null;
    notifyListeners();
  }
}

/// UUID v4 aleatorio para entradas nuevas (mismo formato que el escritorio).
String newUuid() {
  final random = Random.secure();
  final bytes = List<int>.generate(16, (_) => random.nextInt(256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  final hex = bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
}
