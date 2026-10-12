import 'package:flutter/material.dart';
import 'package:xterm/xterm.dart';

import '../l10n/app_localizations.dart';
import '../src/services.dart';
import '../src/terminals.dart';
import 'errors.dart';
import 'theme.dart';

const _terminalTheme = TerminalTheme(
  cursor: Color(0xFFD4D4D8),
  selection: Color(0x666366F1),
  foreground: Color(0xFFE4E4E7),
  background: Color(0xFF0B0B0D),
  black: Color(0xFF18181B),
  red: Color(0xFFF87171),
  green: Color(0xFF4ADE80),
  yellow: Color(0xFFFACC15),
  blue: Color(0xFF60A5FA),
  magenta: Color(0xFFC084FC),
  cyan: Color(0xFF22D3EE),
  white: Color(0xFFE4E4E7),
  brightBlack: Color(0xFF52525B),
  brightRed: Color(0xFFFCA5A5),
  brightGreen: Color(0xFF86EFAC),
  brightYellow: Color(0xFFFDE68A),
  brightBlue: Color(0xFF93C5FD),
  brightMagenta: Color(0xFFD8B4FE),
  brightCyan: Color(0xFF67E8F9),
  brightWhite: Color(0xFFFAFAFA),
  searchHitBackground: Color(0xFFFACC15),
  searchHitBackgroundCurrent: Color(0xFFF97316),
  searchHitForeground: Color(0xFF000000),
);

/// Una terminal SSH a pantalla completa, con barra de teclas especiales.
class TerminalScreen extends StatefulWidget {
  const TerminalScreen({super.key, required this.session});

  final TerminalSession session;

  @override
  State<TerminalScreen> createState() => _TerminalScreenState();
}

class _TerminalScreenState extends State<TerminalScreen> {
  late TerminalSession _session = widget.session;
  final _focus = FocusNode();
  bool _ctrl = false;

  @override
  void initState() {
    super.initState();
    _wire();
  }

  // Ctrl de un toque: la siguiente tecla que se escriba va con Ctrl (Ctrl+C, Ctrl+D…)
  void _wire() {
    final original = _session.terminal.onOutput;
    _session.terminal.onOutput = (data) {
      if (_ctrl && data.length == 1) {
        final code = data.toLowerCase().codeUnitAt(0);
        setState(() => _ctrl = false);
        if (code >= 0x61 && code <= 0x7a) return original?.call(String.fromCharCode(code & 0x1f));
      }
      original?.call(data);
    };
    _wiredOriginal = original;
  }

  void Function(String)? _wiredOriginal;

  void _unwire() {
    _session.terminal.onOutput = _wiredOriginal;
  }

  @override
  void dispose() {
    _unwire();
    _focus.dispose();
    super.dispose();
  }

  void _switchTo(TerminalSession session) {
    _unwire();
    setState(() {
      _session = session;
      _ctrl = false;
    });
    _wire();
  }

  void _key(TerminalKey key) {
    _session.terminal.keyInput(key);
    _focus.requestFocus();
  }

  void _text(String text) {
    _session.terminal.textInput(text);
    _focus.requestFocus();
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final sessions = AppServices.of(context).terminals;
    return ListenableBuilder(
      listenable: Listenable.merge([_session, sessions]),
      builder: (context, _) => Scaffold(
        backgroundColor: _terminalTheme.background,
        appBar: AppBar(
          title: Text(_session.title),
          actions: [
            if (sessions.sessions.length > 1)
              PopupMenuButton<TerminalSession>(
                tooltip: t.terminals,
                icon: const Icon(Icons.tab),
                onSelected: _switchTo,
                itemBuilder: (context) => [for (final s in sessions.sessions) PopupMenuItem(value: s, child: Text(s.title))],
              ),
            if (_session.status == TerminalStatus.closed || _session.status == TerminalStatus.failed)
              IconButton(tooltip: t.reconnect, icon: const Icon(Icons.refresh), onPressed: _session.reconnect),
            IconButton(
              tooltip: t.closeTerminal,
              icon: const Icon(Icons.close),
              onPressed: () {
                sessions.close(_session);
                Navigator.of(context).pop();
              },
            ),
          ],
        ),
        body: SafeArea(
          child: Column(children: [
            if (_session.status != TerminalStatus.open) _StatusBanner(session: _session),
            Expanded(
              child: TerminalView(
                _session.terminal,
                key: const Key('terminal-view'),
                focusNode: _focus,
                autofocus: true,
                theme: _terminalTheme,
                textStyle: const TerminalStyle(fontSize: 13),
                padding: const EdgeInsets.all(6),
                keyboardType: TextInputType.visiblePassword,
              ),
            ),
            _KeyBar(ctrl: _ctrl, onCtrl: () => setState(() => _ctrl = !_ctrl), onKey: _key, onText: _text),
          ]),
        ),
      ),
    );
  }
}

class _StatusBanner extends StatelessWidget {
  const _StatusBanner({required this.session});

  final TerminalSession session;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final (text, color) = switch (session.status) {
      TerminalStatus.connecting => (t.terminalConnecting, AppColors.textMuted),
      TerminalStatus.closed => (t.terminalClosed, AppColors.warning),
      TerminalStatus.failed => (errorText(context, session.error), AppColors.danger),
      TerminalStatus.open => ('', AppColors.textMuted),
    };
    return Container(
      key: const Key('terminal-status'),
      width: double.infinity,
      color: color.withValues(alpha: 0.12),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      child: Row(children: [
        Expanded(child: Text(text, style: TextStyle(color: color, fontSize: 13))),
        if (session.status == TerminalStatus.closed || session.status == TerminalStatus.failed)
          TextButton(onPressed: session.reconnect, child: Text(t.reconnect)),
      ]),
    );
  }
}

/// Teclas que no hay en el teclado del móvil.
class _KeyBar extends StatelessWidget {
  const _KeyBar({required this.ctrl, required this.onCtrl, required this.onKey, required this.onText});

  final bool ctrl;
  final VoidCallback onCtrl;
  final void Function(TerminalKey) onKey;
  final void Function(String) onText;

  @override
  Widget build(BuildContext context) {
    Widget key(String label, VoidCallback onTap, {bool active = false, Key? id}) => Padding(
          padding: const EdgeInsets.symmetric(horizontal: 3),
          child: Material(
            color: active ? AppColors.accent : AppColors.surfaceHigh,
            borderRadius: BorderRadius.circular(8),
            child: InkWell(
              key: id,
              borderRadius: BorderRadius.circular(8),
              onTap: onTap,
              child: Container(
                constraints: const BoxConstraints(minWidth: 44),
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
                alignment: Alignment.center,
                child: Text(label, style: const TextStyle(fontWeight: FontWeight.w600)),
              ),
            ),
          ),
        );
    return Container(
      color: AppColors.surface,
      padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 4),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(children: [
          key('Esc', () => onKey(TerminalKey.escape), id: const Key('key-esc')),
          key('Tab', () => onKey(TerminalKey.tab), id: const Key('key-tab')),
          key('Ctrl', onCtrl, active: ctrl, id: const Key('key-ctrl')),
          key('↑', () => onKey(TerminalKey.arrowUp)),
          key('↓', () => onKey(TerminalKey.arrowDown)),
          key('←', () => onKey(TerminalKey.arrowLeft)),
          key('→', () => onKey(TerminalKey.arrowRight)),
          key('|', () => onText('|')),
          key('/', () => onText('/')),
          key('~', () => onText('~')),
          key('-', () => onText('-')),
        ]),
      ),
    );
  }
}

/// Terminales abiertas: cambiar a una o cerrarla.
class TerminalsScreen extends StatelessWidget {
  const TerminalsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final sessions = AppServices.of(context).terminals;
    return Scaffold(
      appBar: AppBar(title: Text(t.terminals)),
      body: ListenableBuilder(
        listenable: sessions,
        builder: (context, _) {
          if (sessions.sessions.isEmpty) {
            return Center(child: Padding(padding: const EdgeInsets.all(32), child: Text(t.noTerminals, textAlign: TextAlign.center, style: const TextStyle(color: AppColors.textSecondary))));
          }
          return ListView(children: [
            for (final session in sessions.sessions)
              ListTile(
                leading: Icon(Icons.terminal, color: session.status == TerminalStatus.open ? AppColors.success : AppColors.textMuted),
                title: Text(session.title),
                subtitle: Text('${session.connection.str('username')}@${session.connection.str('host')}', style: const TextStyle(color: AppColors.textMuted)),
                onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => TerminalScreen(session: session))),
                trailing: IconButton(tooltip: t.closeTerminal, icon: const Icon(Icons.close), onPressed: () => sessions.close(session)),
              ),
          ]);
        },
      ),
    );
  }
}
