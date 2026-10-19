# Tasks

## 1. Prototipo de riesgo (antes de comprometerse)
- [ ] 1.1 En la VM de Windows 11, un prototipo mínimo: un servicio `LocalSystem` que lance un ayudante en la sesión de consola activa (`WTSGetActiveConsoleSessionId`, `WTSQueryUserToken`, `CreateProcessAsUser`), se re-adjunte al escritorio de entrada (`OpenInputDesktop`/`SetThreadDesktop`) y capture + `SendInput` en `Winlogon`. Verificar: se ve y se pulsa un UAC de prueba. Sin integrar con la app.
- [ ] 1.2 Comprobar el seguimiento del escritorio en los casos difíciles: bloqueo/desbloqueo, Ctrl+Alt+Supr, cambio rápido de usuario y, si aplica, una sesión por RDP. Anotar qué funciona y qué no.

## 2. Servicio y ayudante
- [ ] 2.1 Servicio `AbsorConnectHost` (nativo, sin ventana, sin red): ciclo de vida, arranque con el equipo, y lanzamiento/repliegue del ayudante por sesión de control.
- [ ] 2.2 Ayudante `absor-host-helper`: captura del escritorio activo y aplicación de la entrada ya validada; re-adjuntado al escritorio de entrada al cambiar.
- [ ] 2.3 Aviso de sesión en el escritorio seguro (quién controla), coherente con el aviso actual del escritorio normal.

## 3. IPC local
- [ ] 3.1 Named pipe `\\.\pipe\AbsorConnectHost` con descriptor de seguridad que solo admite al usuario de la sesión de consola y a `LocalSystem`. Secreto efímero por arranque para que solo la app del usuario hable con el servicio.
- [ ] 3.2 Operaciones acotadas: `attach`/`detach`, `frame`, `input`, `notice`. Nada fuera de capturar el escritorio activo y aplicar una entrada ya validada. El servicio rechaza un segundo `attach` (una sesión a la vez) y repliega el ayudante si la app cae.

## 4. Integración con el host de Electron
- [ ] 4.1 `src/main/remote/`: usar el servicio solo cuando hay una sesión autenticada y hace falta el escritorio seguro o una ventana elevada; si no hay servicio, usar la ruta actual (`desktopCapturer` + `SendInput`). La autenticación y el protocolo v1 no cambian.
- [ ] 4.2 Unir la captura del ayudante con la tubería de vídeo existente y la entrada con el flujo del protocolo v1 (misma normalización).

## 5. Ajustes
- [ ] 5.1 Interruptor para activar/desactivar el componente con privilegios en Windows, y los textos `es`/`en` de la nueva situación (qué se puede atender con él, qué no sin él).
- [ ] 5.2 Reflejar el estado del servicio (instalado, activado) y, si falta, cómo obtenerlo.

## 6. Instalador y actualización
- [ ] 6.1 `electron-builder.yml`: instalación per-machine con elevación, registro y arranque del servicio al instalar, y parada y borrado al desinstalar.
- [ ] 6.2 Actualización con `electron-updater` sin cortar una sesión en curso; versionado del binario del servicio.
- [ ] 6.3 Comprobar instalación, actualización y desinstalación en la VM: el servicio queda en el estado correcto en cada caso.

## 7. Seguridad
- [ ] 7.1 Revisión de seguridad específica del servicio y del IPC (como se hizo con el relé TURN): que el servicio no actúe sin sesión autenticada, que el IPC no sea accesible por otros usuarios ni por la red, y que el conjunto de operaciones sea el mínimo.
- [ ] 7.2 Valorar un certificado de firma de Windows para el instalador y el servicio (SmartScreen/antivirus), y documentar la decisión.

## 8. Documentación
- [ ] 8.1 README, `AGENTS.md` y la web: qué cubre el componente con privilegios en Windows, que es opcional y cómo desactivarlo, y la nota de seguridad.
- [ ] 8.2 `prototypes/remote-desktop/README.md`: cómo se prueba en la VM.

## 9. Verificación final
- [ ] 9.1 En la VM de Windows 11: UAC, bloqueo/desbloqueo con contraseña de Windows, Ctrl+Alt+Supr, ventana elevada; y que sin el componente el comportamiento es el de la v0.4.0.
- [ ] 9.2 Caída de la app durante una sesión en el escritorio seguro: el servicio repliega el ayudante.
- [ ] 9.3 `npm run typecheck`, `npm test` y `npx eslint` sobre lo tocado, sin errores nuevos. Tabla de resultados en `verification.md`.
