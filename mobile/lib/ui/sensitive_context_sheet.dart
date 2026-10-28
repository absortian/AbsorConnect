import 'package:flutter/material.dart';

/// Una hoja pertenece a un contexto. Solo retira su propia ruta al invalidarse.
class SensitiveContextSheet extends StatefulWidget {
  const SensitiveContextSheet({
    super.key,
    required this.listenable,
    required this.epoch,
    required this.child,
    this.allowed,
  });
  final Listenable listenable;
  final int Function() epoch;
  final bool Function()? allowed;
  final Widget child;
  @override
  State<SensitiveContextSheet> createState() => _SensitiveContextSheetState();
}

class _SensitiveContextSheetState extends State<SensitiveContextSheet> {
  late final int _epoch;
  bool _closing = false;
  @override
  void initState() {
    super.initState();
    _epoch = widget.epoch();
    widget.listenable.addListener(_changed);
  }

  void _changed() {
    if (_closing ||
        (widget.epoch() == _epoch && (widget.allowed?.call() ?? true))) {
      return;
    }
    _closing = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final route = ModalRoute.of(context);
      if (route != null && route.isActive) route.navigator?.removeRoute(route);
    });
    WidgetsBinding.instance.ensureVisualUpdate();
  }

  @override
  void dispose() {
    widget.listenable.removeListener(_changed);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
