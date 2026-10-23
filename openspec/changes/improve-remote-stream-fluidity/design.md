# Design

## Context

La captura actual de `src/renderer/host/main.ts` pide 30 fps, sin sobre de
resolución, y usa `detail`/`maintain-resolution`. Los visores ya calculan RTT,
ruta y fps. La motivación y las medidas previas figuran en proposal.md y en la
verificación del cambio desatendido. No hay evidencia que identifique la causa
de la sesión histórica del iPad.

## Goals / Non-Goals

**Goals:** acotar trabajo de captura/codificación, permitir elegir el compromiso
entre definición y fluidez, y observar el vídeo recibido sin telemetría.

**Non-Goals:** cambiar autenticación, cifrado, permisos, TURN, coordenadas
normalizadas o introducir un agente privilegiado en esta entrega.

## Decisions

### D1. Perfiles acotados en el host

Equilibrado: sobre 1920×1080, 30 fps, `detail`, degradación `balanced` y techo de
6 Mbit/s. Fluido: 1280×720, 30 fps, `motion`, `maintain-framerate`, 3 Mbit/s.
Resolución original: dimensiones de la fuente, 30 fps, `detail`,
`maintain-resolution`, techo 6 Mbit/s. Son máximos, no ancho de banda reservado
ni frecuencias garantizadas. El navegador conserva su control de congestión.
No se recorta ni amplía la imagen. Se aplican restricciones sobre la pista; los
valores efectivos del motor se observan después.

Se conserva la resolución original como elección consciente para no perder el
uso de texto pequeño. Forzar siempre 4K perpetuaría la carga medida; forzar
siempre 720p reduciría innecesariamente la definición. No se añade un algoritmo
de adaptación propio basado solo en RTT: no identifica el cuello de botella.

- Windows: Chromium captura el monitor elegido; el ajuste no modifica SendInput,
  UAC ni permisos del sistema.
- macOS: mismo ajuste de pista Chromium con TCC existente; sin actualizar el
  helper de laboratorio ni los permisos del Mac físico.
- Linux: mismo ajuste de pista en X11; conserva la fuente PulseAudio/PipeWire y
  el rechazo de Wayland como host. La entrada sigue usando el monitor completo.

### D2. Extensión opcional v1

El host anuncia `streamQuality: true` en `features` solo tras autenticar y usa
`stream-quality` para confirmar `profile`. El controlador envía
`set-stream-quality` únicamente tras recibir la capacidad. Perfiles enumerados
y versión 1 validados, sin parámetros de captura arbitrarios. Clientes antiguos
ignoran las extensiones; clientes nuevos ocultan el control ante hosts antiguos.
La elección vive en la sesión y se reaplica al reconectar después de negociar.
TypeScript y Dart se actualizan juntos; autenticación y sus vectores no cambian.

### D3. Ajustes serializados y cierre seguro

Una cola procesa captura inicial, selección de monitor y perfil. Los perfiles
usan `applyConstraints` sobre la pista activa; los cambios de monitor conservan
el perfil. Se confirma solo tras aplicar. Si falla un perfil se mantiene o
restaura la configuración anterior y se confirma esta. Un cierre durante una
espera detiene cualquier pista obtenida después; no se publican confirmaciones
tardías ni se vuelve a capturar tras terminar.

### D4. Estadísticas locales

En cada visor se calculan por intervalo `bytesReceived` y la diferencia de
`jitterBufferDelay/jitterBufferEmittedCount`. Se muestran resolución y kbit/s,
junto al retardo medio del búfer, sin presentarlo como latencia total de entrada.
Solo se usa el vídeo entrante y el par seleccionado. Se descartan consultas
solapadas/tardías, contadores reiniciados y muestras no finitas. Sin API nueva,
historial persistente, direcciones ICE, títulos de ventana, píxeles o teclas.
Windows, macOS y Linux usan el mismo recolector Chromium; Android/iOS usan los
campos disponibles de flutter_webrtc, conservando desconocidos los ausentes.

## Risks / Trade-offs

- Menos definición inicial en pantallas grandes → selector explícito de
  resolución original y coordenadas normalizadas independientes del vídeo.
- Motores con restricciones parciales → validar valores efectivos, conservar
  sesión utilizable y no confirmar una operación rechazada.
- TURN con presupuesto limitado → techo por perfil sin cambiar cuotas ni
  prometer eliminar pérdidas o retardo de red.
- Simuladores y vídeo artificial → separar evidencia de rendimiento sintético
  de la validación física; no declarar arreglados los tirones históricos.

## Migration Plan

Pruebas de contrato y ciclo de vida, builds de escritorio/Flutter y comparación
controlada de resolución/fps/ruta. Publicar una versión compatible de app/móvil,
conservar datos y credenciales, verificar assets y notas de límites. Los hosts y
clientes pueden actualizarse en distinto orden. Rollback a la release anterior
no requiere migración de datos ni cambios de backend. El Mac mantiene firma
ad-hoc y actualización manual. El agente desatendido sigue su puerta propia.

## Referencias técnicas

- [W3C: Screen Capture](https://w3c.github.io/mediacapture-screen-share/):
  restricciones de dimensiones y conservación del aspecto.
- [W3C: WebRTC](https://www.w3.org/TR/webrtc/): límites de codificación y
  `setParameters`, sin renegociación del SDP.

## D5 — Publicación completa

La compilación de escritorio se ejecuta también en el PR para Windows, macOS
y Linux. Se mantienen los builds móviles del PR. El tag genera una release en
borrador y solo se publica como última versión tras adjuntar APK, IPA y fuente
AltStore, después de terminar los tres builds de escritorio. Un fallo conserva
el borrador y no cambia la versión ofrecida a los usuarios. Las pruebas de
tipos y Vitest también se ejecutan en la matriz de escritorio.
