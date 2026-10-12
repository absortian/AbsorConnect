# Proposal

## Why

En la terminal SSH del escritorio, lo que se teclea tarda en aparecer, y da la sensación de que, enviando muchos comandos seguidos, se perderán letras. Medido contra un servidor con 80 ms de ida y vuelta, cada tecla tarda en verse 132 ms de mediana tecleando rápido y 163 ms a ritmo normal, el doble que la red. Además, todo lo que se escribe mientras la terminal se abre o se reconecta se descarta.

## What Changes

- La conexión SSH envía cada paquete en cuanto se produce: se desactiva el algoritmo de Nagle (`TCP_NODELAY`), como hace OpenSSH en las sesiones interactivas. El eco pasa a tardar lo que tarda la red.
- Lo que se escribe mientras la terminal se abre o se reconecta se guarda y se envía en orden al abrirse la sesión, en vez de perderse.
- Queda comprobado y especificado que, con la sesión abierta, todo lo escrito o pegado llega completo y en orden aunque se envíen muchos comandos seguidos.

## Capabilities

### New Capabilities
<!-- Ninguna -->

### Modified Capabilities
- `ssh-terminal`: nuevo requisito de entrada inmediata y sin pérdidas.

## Impact

- **Proceso principal:** `src/main/ssh.ts` (socket de la conexión SSH del pool, que comparten la terminal y el explorador SFTP).
- **Renderer:** `src/renderer/src/components/TerminalView.tsx` y un módulo pequeño con la cola de entrada.
- **Usuarios existentes:** ninguno en datos, credenciales ni auto-update. La terminal responde antes; las transferencias SFTP no cambian.

## Fuera de alcance

- Eco local o predictivo (mostrar las letras antes de que responda el servidor, como Mosh): el eco seguirá tardando lo que tarda la red.
- La terminal de la app móvil (otra base de código, sin este problema medido).
- Cambiar el motor de dibujo de xterm.js.
