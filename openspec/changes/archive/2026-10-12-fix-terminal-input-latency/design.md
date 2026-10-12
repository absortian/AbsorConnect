# Design

## Context

El camino de una tecla es: xterm.js (`onData`) → `ipcRenderer.send` → `ipcMain.on` → `channel.write` de ssh2 → socket TCP. Los dos primeros saltos son ordenados y sin temporizadores, y el canal de ssh2 guarda en su búfer lo que no cabe en la ventana del servidor, así que no pierde datos. Pero ssh2 nunca activa `TCP_NODELAY` (tiene `setNoDelay()`, que nadie llamaba), y el renderer descarta lo tecleado cuando aún no hay sesión (`if (sessionRef.current)`).

Medición de partida, con un servidor de pruebas con 80 ms de ida y vuelta (latencia real con `netem`, cliente en la misma red de Docker): eco de cada tecla de 132 ms de mediana tecleando rápido (1 tecla cada 30 ms) y de 163 ms a ritmo normal (1 cada 120 ms). 2000 comandos seguidos con Enter llegaron todos y en orden.

## Goals / Non-Goals

**Goals:**
- Eco de cada tecla en el tiempo de ida y vuelta de la red.
- Nada de lo tecleado se pierde ni se desordena, tampoco al abrir o reconectar.

**Non-Goals:**
- Eco local o predictivo (ver Fuera de alcance en la propuesta).

## Decisions

### D1. `TCP_NODELAY` en la conexión SSH
`client.setNoDelay(true)` al emitir ssh2 el evento `connect` (el socket ya existe y está conectado). Con Nagle activo, cada tecla espera el ACK de la anterior antes de salir, y el eco llega a ráfagas. OpenSSH hace lo mismo en las sesiones interactivas.
- **macOS, Windows y Linux:** igual en los tres; es una opción del socket de Node.
- **SFTP:** comparte la conexión. Las transferencias envían paquetes grandes, que Nagle no retiene, así que no cambian.
- **Alternativa descartada:** agrupar las teclas en el renderer o en el proceso principal; añadiría latencia en vez de quitarla.

### D2. Cola de entrada mientras se abre la sesión
Un módulo pequeño (`terminalInput.ts`) guarda lo que se teclea mientras la terminal se abre o se reconecta y lo envía, en orden, en cuanto hay sesión. Lo que se escribe después se envía directamente, siempre detrás de lo guardado.
- **Si la apertura falla:** se descarta, porque la persona no sabe cuándo se reintentará.
- **Con la sesión terminada y sin pedir reconectar:** no se guarda nada, para no ejecutar órdenes antiguas por sorpresa al reconectar.
- **macOS, Windows y Linux:** igual en los tres (renderer).

### D3. Integridad con muchos comandos seguidos
No hace falta cambio: IPC y el stream de ssh2 conservan el orden y guardan en búfer lo que no cabe. Se verifica con 2000 comandos seguidos, y el propio servidor comprueba que llegaron todos y en orden.

## Risks / Trade-offs

- **[Eco ligado a la red]** Con servidores lejanos el eco sigue tardando lo que tarda la red. → Es el límite de SSH sin eco local.
- **[Más paquetes pequeños]** Sin Nagle cada tecla es un paquete. → Es lo habitual en terminales interactivas y el tráfico es mínimo.
