# Tasks

## 1. Proceso principal

- [x] 1.1 `client.setNoDelay(true)` al conectar el socket de la conexión SSH del pool, con el motivo en un comentario (D1).

## 2. Renderer

- [x] 2.1 Cola de entrada (`terminalInput.ts`): guarda lo tecleado mientras la sesión se abre o se reconecta, lo envía en orden al abrirse y lo descarta si la apertura falla; con la sesión terminada no guarda nada (D2).
- [x] 2.2 `TerminalView.tsx` usa la cola en `onData`, al abrir la sesión, al fallar y al terminar.

## 3. Documentación

- [x] 3.1 `AGENTS.md`: por qué no quitar `setNoDelay` ni enviar la entrada sin la cola.

## 4. Verificación

- [x] 4.1 Banco de pruebas con 80 ms de ida y vuelta y el módulo SSH real de la app: el eco de cada tecla baja al tiempo de la red, tecleando rápido y a ritmo normal; 2000 comandos seguidos llegan todos y en orden.
- [x] 4.2 Prueba de la cola de entrada: orden al abrir, envío directo detrás de lo guardado, descarte al fallar y nada guardado con la sesión terminada.
- [x] 4.3 `npm run typecheck` sin errores y ESLint sin errores nuevos en los ficheros tocados.
