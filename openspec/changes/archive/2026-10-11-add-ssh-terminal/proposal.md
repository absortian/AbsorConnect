# Proposal

## Why

Con las conexiones SSH de `add-sftp-connections` el usuario ya puede gestionar archivos de sus servidores, pero para cualquier otra tarea tiene que salir a otra herramienta. Una terminal SSH integrada sobre la misma conexión convierte Absor Connect en el punto único para trabajar con un servidor: archivos y consola, sin volver a configurar credenciales.

## What Changes

- Desde una conexión SSH se puede **abrir una terminal interactiva**, con un botón en la cabecera cuando la conexión activa es SSH y una acción en la propia conexión de la barra lateral.
- **Varias terminales a la vez** en pestañas, del mismo servidor o de servidores distintos. La zona principal pasa a tener una barra de pestañas: "Archivos" (el doble panel actual) y una pestaña por terminal. Cambiar de pestaña o de conexión activa no cierra las terminales.
- Terminal completa: colores, UTF-8, programas a pantalla completa (vim, htop), Ctrl+C como interrupción, redimensionado automático del tamaño remoto y copiar y pegar con los atajos de cada sistema.
- Fin de sesión visible (por `exit` o por conexión perdida), con opción de **reconectar** en la misma pestaña. Cerrar la pestaña cierra la sesión en el servidor.
- Los errores al abrir la terminal (autenticación, host inalcanzable…) usan los mismos códigos y textos que el explorador SFTP.

## Fuera de alcance

- Port forwarding (túneles `-L`/`-R`), agent forwarding, X11, jump hosts.
- Sesiones persistentes entre reinicios de la app, grabación de sesiones, snippets o comandos guardados.
- Dividir la terminal en paneles (split) o arrastrar pestañas entre ventanas.
- Terminal local (shell del propio equipo).
- Verificación de host key (heredado de `add-sftp-connections`: no se verifica).

## Impacto en usuarios existentes

- **Datos, credenciales y auto-update:** ninguno. Usa las conexiones SSH tal como las define `add-sftp-connections`, sin campos nuevos.
- **Interfaz:** aparece la barra de pestañas sobre el doble panel. Con una conexión S3 solo existe la pestaña "Archivos" y el comportamiento es el de siempre.

## Capabilities

### New Capabilities
- `ssh-terminal`: sesiones de terminal interactiva sobre conexiones SSH, en pestañas, con su ciclo de vida (abrir, usar, redimensionar, copiar y pegar, terminar, reconectar y cerrar).

### Modified Capabilities
(ninguna. Depende de `connection-management` y `sftp-explorer`, que crea `add-sftp-connections`, pero no cambia sus requisitos)

## Impact

- **Requisito previo:** `add-sftp-connections` aplicado (tipo `SshConnection` y pool de `src/main/ssh.ts`).
- **Dependencias nuevas:** `@xterm/xterm` 6 y `@xterm/addon-fit` (renderer, sin código nativo).
- **Main:** `src/main/ssh.ts` (registro de sesiones `shell` sobre el pool) e `index.ts` (canales `ssh-terminal-*`).
- **Preload:** API de terminal (invoke, send y eventos) y portapapeles.
- **Renderer:** `App.tsx` (barra de pestañas y estado de terminales abiertas), nuevo `TerminalView.tsx`, `ConnectionsSidebar.tsx` (acción "Abrir terminal"), estilos en `main.css` y locales en/es.
