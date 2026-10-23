# Extensión compatible del canal control v1

Tras autenticar y empezar la captura, `features` puede añadir
`"streamQuality":true`. Solo entonces el controlador puede enviar
`{"v":1,"type":"set-stream-quality","profile":"smooth"}`. El host confirma
el perfil aplicado con `{"v":1,"type":"stream-quality","profile":"smooth"}`.
Valores válidos: `balanced`, `smooth`, `native`. La extensión exige versión
numérica 1; otras versiones, valores o tipos se ignoran. No permite elegir
parámetros arbitrarios. Antes de autenticar se descarta la petición.

`balanced` limita a 1920×1080, `smooth` a 1280×720 y `native` conserva las
dimensiones de la fuente. Todos limitan a 30 fps, sin recortar ni ampliar. Los
máximos de codificación son 6/3/6 Mbit/s respectivamente, sujetos al control de
congestión de WebRTC. No implican ancho de banda reservado. Si se rechaza un
cambio se restaura y confirma el perfil anterior; si tampoco puede restaurarse,
se cierra la captura en lugar de confirmar un estado no aplicado.

Los tipos previos mantienen su formato. Un controlador anterior ignora la
capacidad y confirmación nuevas; uno actual no envía peticiones ni muestra el
selector si el host no anuncia la capacidad. La preferencia solo vive en la
sesión del visor, reaplicada después de negociar en una reconexión.

No cambian PBKDF2, HMAC, huellas, canales de entrada, transferencias ni API.
Referencias ejecutables: `protocol.ts`, `protocol.dart` y sus pruebas de contrato.
