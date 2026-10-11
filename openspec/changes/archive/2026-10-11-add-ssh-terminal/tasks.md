# Tasks

## 1. Dependencias

- [x] 1.1 Comprobar que `add-sftp-connections` está aplicado (`src/main/ssh.ts` y `SshConnection` existen) y añadir `@xterm/xterm` y `@xterm/addon-fit` con `npm install`. Verificar: `npm ls @xterm/xterm @xterm/addon-fit` y `npm run typecheck` pasan.

## 2. Main

- [x] 2.1 En `src/main/ssh.ts`, añadir el registro de sesiones `shell` sobre el pool: abrir con pty `xterm-256color`, escribir, redimensionar, cerrar, emitir `data`/`exit` (`exit` | `connection-lost`), no cerrar clientes con sesiones abiertas y limpiar al destruirse el `webContents` o al salir (D2). Verificar: desde la consola de `npm run dev`, abrir una sesión contra el servidor de pruebas devuelve un `sessionId` y llegan eventos de datos.
- [x] 2.2 En `index.ts`, registrar `ssh-terminal-open`/`ssh-terminal-close` (invoke) e `ssh-terminal-input`/`ssh-terminal-resize` (on), validando que el `sessionId` pertenece al `webContents` emisor. Verificar: `npm run typecheck:node` pasa, y un `sessionId` inventado se ignora sin lanzar error.

## 3. Preload

- [x] 3.1 Exponer la API de terminal (`openTerminal`, `closeTerminal`, `terminalInput`, `terminalResize`, `onTerminalData`, `onTerminalExit` con su desuscripción), `clipboardReadText`/`clipboardWriteText` y `platform`, con sus tipos en `index.d.ts`. Verificar: `npm run typecheck` pasa.

## 4. Renderer

- [x] 4.1 Crear `TerminalView.tsx` (D4): xterm + fit, apertura con el tamaño inicial, `ResizeObserver` → resize, entrada y salida en `Uint8Array`, tema claro y oscuro, fuente por sistema, y franja de sesión terminada o error con "Reconectar". Verificar: con `npm run dev`, una terminal al servidor de pruebas muestra el prompt y ejecuta comandos.
- [x] 4.2 Atajos de copiar y pegar por sistema con `attachCustomKeyEventHandler` y el portapapeles del preload (D5). Verificar en macOS: Cmd+C y Cmd+V copian y pegan, y Ctrl+C interrumpe `sleep 100`.
- [x] 4.3 `App.tsx`: estado `terminals` y `activeTab`, barra de pestañas (Archivos + terminales con cerrar y títulos " (n)"), terminales siempre montadas y ocultas cuando no están activas, y botón "Abrir terminal" en la cabecera solo para conexiones SSH (D3). Verificar: abrir dos terminales, cambiar entre pestañas y de conexión activa no pierde la salida.
- [x] 4.4 `ConnectionsSidebar.tsx`: acción "Abrir terminal" en las filas de conexiones SSH que abre la terminal sin cambiar la conexión activa. Verificar: con `npm run dev`, la acción aparece solo en las conexiones SSH.
- [x] 4.5 Estilos de la barra de pestañas en `main.css` (oscuro y claro) y textos en `locales/en.json` y `es.json` (pestañas, abrir terminal, sesión terminada, conexión perdida, reconectar). Verificar: sin claves i18n sin traducir en en ni en es, y legible en los dos temas.

## 5. Documentación

- [x] 5.1 README: añadir la terminal SSH a características y stack (xterm.js), con los atajos de copiar y pegar por sistema. Verificar: lectura del README renderizado.

## 6. Verificación

- [x] 6.1 `npm run typecheck` pasa y los ficheros nuevos o tocados no añaden errores de lint respecto a `main`.
- [x] 6.2 (manual, `npm run dev` en macOS, contra el servidor SSH de pruebas de `add-sftp-connections`) Recorrer los escenarios de `specs/ssh-terminal/spec.md`: abrir desde la cabecera y desde la barra lateral, ausencia en S3, dos terminales al mismo servidor, cambio de pestaña y de conexión, `vim`/`htop`, `printf 'ñandú €\n'`, Ctrl+C sobre `sleep 100`, `tput cols` tras redimensionar, copiar y pegar, `exit` + Reconectar, parar el contenedor (conexión perdida) + Reconectar al arrancarlo, y cerrar la pestaña (un bucle que escribe un latido en un fichero del servidor deja de actualizarse; en este servidor de pruebas `ps` no ve los procesos de otras sesiones).
- [x] 6.3 (manual) Error al abrir: contraseña errónea y host inexistente muestran en la pestaña el mismo texto que el explorador SFTP, y "Reintentar" funciona tras corregir.
- [x] 6.4 Empaquetado: `npm run build:mac` y la terminal funciona en la app empaquetada (CSS de xterm incluido, fuente correcta). En Linux (VM de OrbStack con xvfb, por CDP) y Windows (workflow temporal en GitHub Actions, por CDP), comprobar en el paquete instalado que se abre una pestaña de terminal y que, contra un host inexistente, muestra `SSH_UNREACHABLE`. En Linux, además, que `echo` contra el servidor de pruebas devuelve la salida.
- [x] 6.5 (manual, Windows o Linux con escritorio) Copiar y pegar con Ctrl+Shift+C y Ctrl+Shift+V, y Ctrl+C como interrupción.

## Workflow follow-up

- Archivar el change (`/opsx:archive`) cuando todo esté verificado, para que `ssh-terminal` pase a `openspec/specs/`.
