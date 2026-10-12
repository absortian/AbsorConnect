import 'package:flutter/widgets.dart';

import 'api.dart';
import 'connections.dart';
import 'keys.dart';
import 'session.dart';
import 'ssh.dart';
import 'terminals.dart';
import 'transfers.dart';

/// Servicios de la app, creados una vez y accesibles desde cualquier pantalla.
class AppServices {
  AppServices._(this.api, this.session, this.connections, this.keys, this.ssh, this.terminals, this.transfers);

  factory AppServices.create({ApiClient? api}) {
    final client = api ?? ApiClient();
    final session = Session(client);
    final keys = KeyStore();
    final ssh = SshPool(keys);
    final terminals = TerminalSessions(ssh);
    final transfers = TransferManager();
    final services = AppServices._(client, session, ConnectionsStore(session), keys, ssh, terminals, transfers);
    // Al cerrar la sesión (o caducar) no queda nada abierto de la cuenta anterior
    session.addSignOutListener(() {
      terminals.closeAll();
      ssh.closeAll();
      transfers.clear();
    });
    return services;
  }

  final ApiClient api;
  final Session session;
  final ConnectionsStore connections;
  final KeyStore keys;
  final SshPool ssh;
  final TerminalSessions terminals;
  final TransferManager transfers;

  static AppServices of(BuildContext context) => context.dependOnInheritedWidgetOfExactType<ServicesScope>()!.services;
}

class ServicesScope extends InheritedWidget {
  const ServicesScope({super.key, required this.services, required super.child});

  final AppServices services;

  @override
  bool updateShouldNotify(ServicesScope oldWidget) => !identical(services, oldWidget.services);
}
