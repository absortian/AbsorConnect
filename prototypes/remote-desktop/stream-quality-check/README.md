# Perfiles de vídeo — prueba artificial

Prueba el configurador de codificación de producción contra un receptor Chromium
real, con transceptores recvonly, replaceTrack, estadísticas y eco de un canal de
datos. Usa dibujos artificiales dimensionados a cada perfil: no captura pantallas,
no genera entrada del sistema y no demuestra el escalado del capturador de cada OS.

Desde la raíz:

```sh
npx esbuild prototypes/remote-desktop/stream-quality-check/renderer.ts --bundle --platform=browser --outfile=prototypes/remote-desktop/stream-quality-check/out/renderer.js
```

Crear `out/index.html` con un script `renderer.js` y ejecutar Electron con
`main.cjs --work=/ruta/privada --route=direct` (o `limited`, `udp`, `tls`).
`limited` impone un techo de codificación de 1 Mbit/s, no simula el ancho de banda
de Internet. Para UDP/TLS se requiere `turn-<ruta>.json` privado en work con
credenciales TURN temporales; nunca guardar secretos del servicio en el repo.
Cada caso dura unos 18 segundos. Los informes no incluyen SDP ni IPs ICE.

Los máximos de vídeo vienen de `src/renderer/host/capture.ts`. No afirma haber
reproducido la sesión física histórica iPad → Windows ni garantiza fps/latencia.
