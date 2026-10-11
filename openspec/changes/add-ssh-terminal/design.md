# Design

## Context

Ver proposal.md (Why). Este change parte del estado que deja `add-sftp-connections`:

- `SshConnection` en `src/shared/types.ts`.
- `src/main/ssh.ts` con un pool de `ssh2.Client` por conexión, autenticación, códigos de error `SSH_*` y cierre en `before-quit`.
- `App.tsx` con el doble panel (`LocalExplorer | S3Explorer/SftpExplorer`) como único contenido de la zona principal, y la ventana con `sandbox: false` y `contextIsolation` por defecto (activado).

## Goals / Non-Goals

**Goals:**
- Reutilizar la conexión SSH del pool: cada terminal es un canal `shell` más sobre el mismo `Client` que usa SFTP. No se vuelve a autenticar.
- Que el texto sea fiel (UTF-8 partido entre paquetes, secuencias de escape) y que la entrada tenga baja latencia.
- Que las terminales sobrevivan a los cambios de pestaña y de conexión activa.

**Non-Goals:**
- Reconexión automática. Reconectar es siempre una acción del usuario.
- Limitar el número de pestañas.

## Decisions

### D1. Emulador: xterm.js en el renderer

`@xterm/xterm` 6 con `@xterm/addon-fit`, `scrollback: 5000` y `term.write(Uint8Array)` para que xterm decodifique UTF-8 aunque una secuencia llegue partida.

*Alternativas descartadas:*
- **`node-pty` + `ssh` del sistema:** dependencia nativa obligatoria y requiere un cliente `ssh` instalado (no garantizado en Windows).
- **Una terminal hecha a mano:** inviable para vim o htop.

### D2. Sesiones `shell` en el proceso principal

`ssh.ts` añade un registro `sessionId → { channel, webContentsId, connectionKey }`:

| Canal IPC | Tipo | Efecto |
|---|---|---|
| `ssh-terminal-open (conn, cols, rows)` | invoke | `client.shell({ term: 'xterm-256color', cols, rows })` sobre el pool → devuelve `sessionId` (UUID) |
| `ssh-terminal-input (sessionId, data: string)` | send | `channel.write(data)`. Es fire-and-forget para no añadir latencia por tecla. |
| `ssh-terminal-resize (sessionId, cols, rows)` | send | `channel.setWindow(rows, cols, 0, 0)` |
| `ssh-terminal-close (sessionId)` | invoke | `channel.close()` y se elimina del registro |
| `ssh-terminal-data {sessionId, data: Uint8Array}` | evento | Salida de stdout y stderr del canal |
| `ssh-terminal-exit {sessionId, reason: 'exit' \| 'connection-lost', code?}` | evento | Fin de sesión |

- **Seguridad:** los canales solo actúan sobre sesiones creadas por el mismo `webContents` e ignoran los `sessionId` desconocidos.
- **Limpieza:** cuando un `Client` se cierra (`close`/`error`), todas sus sesiones emiten `exit` con `connection-lost`. Al destruirse el `webContents` o al salir de la app, se cierran todas.
- **Pool:** el pool del change anterior no cierra un `Client` que tenga sesiones abiertas.

### D3. Pestañas en la zona principal

`App.tsx` mantiene `terminals: { id, connectionId, title, sessionId | null, status: 'connecting' | 'open' | 'ended' | 'error', error? }[]` y `activeTab: 'files' | terminalId`.
- La barra de pestañas muestra "Archivos" (siempre) y una pestaña por terminal con su botón de cerrar. El título es el nombre de la conexión, con " (n)" si se repite.
- **Todas** las `TerminalView` se quedan montadas y las inactivas se ocultan con `display: none`, así conservan el buffer y la sesión. Al mostrarse se recalcula el tamaño (`fit`).
- Cambiar la conexión activa solo afecta a "Archivos".
- Puntos de entrada:
  - Un botón con el icono lucide `SquareTerminal` en la cabecera, si la conexión activa es SSH.
  - El mismo icono en la fila de cada conexión SSH de la barra lateral, junto a editar y borrar.

### D4. `TerminalView.tsx`

- Crea `Terminal` y `FitAddon` al montar y los destruye al desmontar (cerrar la pestaña). Llama a `ssh-terminal-open` con el tamaño inicial tras el primer `fit`.
- Un `ResizeObserver` sobre el contenedor (con `requestAnimationFrame` como debounce) hace `fit` y envía `ssh-terminal-resize` solo si cambian filas o columnas. Cubre ventana, barra lateral y pestañas.
- `term.onData` → `ssh-terminal-input`, y `term.onResize` → `ssh-terminal-resize` (el evento salta cuando xterm aplica el tamaño nuevo; además se reenvía el tamaño al abrir la sesión).
- La salida que llega antes de conocer el `sessionId` (el prompt puede adelantarse a la respuesta de `ssh-terminal-open`) se guarda y se vuelca al recibirlo.
- Conectar y reconectar leen la versión guardada más reciente de la conexión, para que un reintento aplique las credenciales corregidas.
- Con `status: 'ended' | 'error'` muestra una franja superpuesta con el motivo (i18n, mismos textos `SSH_*` que SFTP) y el botón "Reconectar". Reconectar abre una sesión nueva en la misma `Terminal` tras escribir una línea separadora; no se borra el buffer.
- **Tema:** los colores del tema oscuro y claro de la app (variables de `main.css`) se pasan como `ITheme` al cambiar el tema.
- **Fuente:** pila monoespaciada por sistema. En macOS `SF Mono, Menlo`; en Windows `Cascadia Mono, Consolas`; en Linux `DejaVu Sans Mono, Ubuntu Mono`; y `monospace` como último recurso.

### D5. Copiar y pegar por sistema

Se usa `term.attachCustomKeyEventHandler`, y el portapapeles lo gestiona el módulo `clipboard` de Electron en el proceso principal; el preload lo expone mediante IPC (`clipboard-read-text` / `clipboard-write-text`). Así funciona igual con `file://` en producción que con el servidor de desarrollo, sin depender de los permisos de `navigator.clipboard` ni de que el módulo esté disponible en el renderer.

| Sistema | Copiar | Pegar | Ctrl+C |
|---|---|---|---|
| **macOS** | Cmd+C (si hay selección) | Cmd+V | Interrupción (`\x03`) |
| **Windows** | Ctrl+Shift+C | Ctrl+Shift+V | Interrupción |
| **Linux** | Ctrl+Shift+C | Ctrl+Shift+V | Interrupción |

Pegar usa `term.paste()`, que respeta el bracketed paste si el programa remoto lo activa. El sistema se detecta con `navigator.userAgent` o con un `platform` expuesto por el preload.

### D6. Barra de pestañas y estilos

Los estilos van en `main.css` con las variables existentes, válidos para el tema oscuro y el claro. Se importa `@xterm/xterm/css/xterm.css` en el componente.

## Risks / Trade-offs

- **[Latencia de entrada por IPC]** Cada tecla cruza renderer → main → red. → Se usa `send`, que no espera respuesta. La latencia de IPC es despreciable frente a la de red.
- **[Mucha salida (por ejemplo `cat` de un fichero enorme) satura el IPC o el renderer]** → xterm escribe por lotes. Si se detectan bloqueos, se agruparán los eventos `ssh-terminal-data` cada ~16 ms en main (mejora acotada, sin cambiar la spec).
- **[Una conexión compartida: si cae, caen el explorador y todas sus terminales]** → Es lo esperado de "una conexión por servidor". Cada pestaña permite reconectar de forma independiente.
- **[Host key sin verificar]** Se hereda de `add-sftp-connections`. En una terminal el impacto es mayor, porque un man-in-the-middle ve todo lo tecleado. → Ya documentado. Refuerza la conveniencia del change futuro de verificación.
- **[Atajos que choquen con el menú de la app]** En macOS el menú por defecto de Electron tiene Edición con Cmd+C y Cmd+V. → El manejador de xterm actúa antes con el foco en la terminal. Hay que verificarlo en macOS (tareas).

## Migration Plan

1. Requiere `add-sftp-connections` aplicado. Sin migración de datos.
2. **Rollback:** revertir el change. Desaparecen la barra de pestañas y la terminal, y SFTP no se ve afectado.
