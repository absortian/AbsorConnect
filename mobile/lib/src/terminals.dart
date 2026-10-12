import 'dart:async';
import 'dart:convert';

import 'package:dartssh2/dartssh2.dart';
import 'package:flutter/foundation.dart';
import 'package:xterm/xterm.dart';

import 'connections.dart';
import 'ssh.dart';

enum TerminalStatus { connecting, open, closed, failed }

/// Una terminal abierta sobre una conexión SSH. La [Terminal] de xterm conserva el
/// contenido aunque la sesión se cierre, y [reconnect] abre otra shell en ella.
class TerminalSession extends ChangeNotifier {
  TerminalSession(this.id, this.connection, this.title, this._pool) {
    terminal.onOutput = (data) => _shell?.write(Uint8List.fromList(utf8.encode(data)));
    terminal.onResize = (width, height, pixelWidth, pixelHeight) {
      if (width > 0 && height > 0) _shell?.resizeTerminal(width, height, pixelWidth, pixelHeight);
    };
  }

  final int id;
  final Entry connection;
  final String title;
  final SshPool _pool;
  final Terminal terminal = Terminal(maxLines: 5000);

  SSHSession? _shell;
  TerminalStatus status = TerminalStatus.connecting;
  Object? error;

  Future<void> connect() async {
    status = TerminalStatus.connecting;
    error = null;
    notifyListeners();
    try {
      final client = await _pool.client(connection);
      final shell = await client.shell(
        pty: SSHPtyConfig(
          type: 'xterm-256color',
          width: terminal.viewWidth > 0 ? terminal.viewWidth : 80,
          height: terminal.viewHeight > 0 ? terminal.viewHeight : 24,
        ),
      );
      _shell = shell;
      status = TerminalStatus.open;
      notifyListeners();
      final decoder = const Utf8Decoder(allowMalformed: true);
      shell.stdout.cast<List<int>>().transform(decoder).listen(terminal.write);
      shell.stderr.cast<List<int>>().transform(decoder).listen(terminal.write);
      unawaited(shell.done.then((_) => _ended(), onError: (_) => _ended()));
    } on Object catch (e) {
      error = toSshError(e);
      status = TerminalStatus.failed;
      notifyListeners();
    }
  }

  void _ended() {
    if (status != TerminalStatus.open) return;
    _shell = null;
    status = TerminalStatus.closed;
    notifyListeners();
  }

  Future<void> reconnect() => connect();

  void close() {
    _shell?.close();
    _shell = null;
    status = TerminalStatus.closed;
  }
}

/// Terminales abiertas, para cambiar entre ellas sin perder su contenido.
class TerminalSessions extends ChangeNotifier {
  TerminalSessions(this.pool);

  final SshPool pool;
  final List<TerminalSession> _sessions = [];
  int _nextId = 1;

  List<TerminalSession> get sessions => List.unmodifiable(_sessions);

  TerminalSession open(Entry connection) {
    final titles = _sessions.map((s) => s.title).toSet();
    var title = connection.name;
    for (var n = 2; titles.contains(title); n++) {
      title = '${connection.name} ($n)';
    }
    final session = TerminalSession(_nextId++, connection, title, pool);
    _sessions.add(session);
    notifyListeners();
    unawaited(session.connect());
    return session;
  }

  void close(TerminalSession session) {
    session.close();
    _sessions.remove(session);
    notifyListeners();
  }

  void closeAll() {
    for (final session in _sessions) {
      session.close();
    }
    _sessions.clear();
    notifyListeners();
  }
}
