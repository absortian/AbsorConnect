import 'dart:convert';

import 'package:absor_connect/src/remote/agent_protocol.dart';
import 'package:absor_connect/src/remote/agent_viewer_state.dart';
import 'package:flutter_test/flutter_test.dart';

const caps = AgentCapabilitiesMessage(
  agentVersion: '0.1.0',
  actions: [],
  capabilities: AgentCapabilities(
    administration: false,
    login: false,
    secureAttention: false,
    restart: false,
  ),
);
String context(
  int sequence, [
  AgentContext state = AgentContext.userDesktop,
  bool image = true,
]) => jsonEncode(
  AgentContextMessage(
    sequence: sequence,
    state: state,
    imageAvailable: image,
  ).toJson(),
);
void main() {
  test('legado y versiones desconocidas no negocian ni aceptan contexto', () {
    final s = AgentViewerState();
    expect(s.accept(jsonEncode(caps.toJson())), false);
    expect(s.accept(context(1)), false);
    expect(s.announce(2, true), false);
    expect(s.announce(1, false), false);
    expect(s.status.enabled, false);
    expect(s.status.sensitiveAllowed, true);
  });
  test('espera capacidades y contexto e ignora repetición, estado inválido y secuencia antigua', () {
    final s = AgentViewerState();
    expect(s.announce(1, true), true);
    expect(s.announce(1, true), false);
    expect(s.status.imageAvailable, false);
    expect(s.accept(context(1)), true);
    expect(s.status.inputAllowed, false);
    expect(s.accept(jsonEncode(caps.toJson())), true);
    expect(s.status.sensitiveAllowed, true);
    expect(s.accept(jsonEncode(caps.toJson())), false);
    expect(s.accept(context(1, AgentContext.locked)), false);
    expect(s.accept(context(2, AgentContext.transition, true)), false);
    expect(s.status.state, AgentContext.userDesktop);
  });
  test('la transición suspende contenido hasta una conexión nueva', () {
    final s = AgentViewerState();
    s.announce(1, true);
    s.accept(jsonEncode(caps.toJson()));
    s.accept(context(1));
    s.accept(context(2, AgentContext.transition, false));
    expect(s.status.imageAvailable, false);
    expect(s.status.inputAllowed, false);
    s.accept(context(3, AgentContext.securePrompt));
    expect(s.status.inputAllowed, false);
    expect(s.status.sensitiveAllowed, false);
    s.accept(context(4));
    expect(s.status.inputAllowed, true);
    expect(s.status.sensitiveAllowed, false);
    final fresh = AgentViewerState();
    fresh.announce(1, true);
    fresh.accept(jsonEncode(caps.toJson()));
    fresh.accept(context(1));
    expect(fresh.status.sensitiveAllowed, true);
  });
  test('la entrada protegida necesita capacidad; su retirada se aplica inmediatamente', () {
    final s = AgentViewerState();
    s.announce(1, true);
    const allowed = AgentCapabilitiesMessage(
      agentVersion: '0.1.0',
      actions: [],
      capabilities: AgentCapabilities(
        administration: true,
        login: true,
        secureAttention: false,
        restart: false,
      ),
    );
    s.accept(jsonEncode(allowed.toJson()));
    s.accept(context(1, AgentContext.login));
    expect(s.status.inputAllowed, true);
    expect(s.status.sensitiveAllowed, false);
    expect(s.accept(jsonEncode(caps.toJson())), true);
    expect(s.status.inputAllowed, false);
    s.accept(context(2, AgentContext.securePrompt));
    expect(s.status.inputAllowed, false);
    s.accept(jsonEncode(allowed.toJson()));
    expect(s.status.inputAllowed, true);
  });
  test('retira acciones aunque las capacidades no cambien', () {
    final state=AgentViewerState();state.announce(1,true);
    const message=AgentCapabilitiesMessage(agentVersion:'0.1.0', actions:[AgentAction.lock], capabilities:AgentCapabilities(administration:false,login:false,secureAttention:false,restart:false));
    expect(state.accept(jsonEncode(message.toJson())),true);expect(state.actions,[AgentAction.lock]);
    expect(state.accept(jsonEncode(caps.toJson())),true);expect(state.actions,isEmpty);
  });

}
