import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../src/remote/agent_protocol.dart';
import '../src/remote/agent_viewer_state.dart';

/// Estado declarado del host; no certifica sus pantallas o permisos del SO.
class AgentContextNotice extends StatelessWidget {
  const AgentContextNotice({
    super.key,
    required this.status,
    required this.imageCurrent,
  });
  final AgentViewerStatus status;
  final bool imageCurrent;
  @override
  Widget build(BuildContext context) {
    if (!status.enabled) return const SizedBox.shrink();
    final t = AppLocalizations.of(context);
    final title = switch (status.state) {
      AgentContext.userDesktop => t.remoteAgentDesktop,
      AgentContext.locked => t.remoteAgentLocked,
      AgentContext.login => t.remoteAgentLogin,
      AgentContext.securePrompt => t.remoteAgentPrompt,
      AgentContext.transition => t.remoteAgentTransition,
      AgentContext.unavailable => t.remoteAgentUnavailable,
    };
    final hint = !status.imageAvailable
        ? t.remoteAgentImageMissing
        : !imageCurrent
        ? t.remoteAgentImageWaiting
        : !status.inputAllowed
        ? t.remoteAgentInputUnavailable
        : status.sensitiveAllowed
        ? ''
        : status.state == AgentContext.userDesktop
        ? t.remoteAgentReconnectContent
        : t.remoteAgentSensitiveSuspended;
    return ColoredBox(
      color: Colors.black87,
      child: Padding(
        padding: const EdgeInsets.all(10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              title,
              key: const Key('agent-context-title'),
              style: const TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.bold,
              ),
            ),
            if (hint.isNotEmpty)
              Text(
                hint,
                key: const Key('agent-context-hint'),
                style: const TextStyle(color: Colors.white70, fontSize: 12),
              ),
          ],
        ),
      ),
    );
  }
}
