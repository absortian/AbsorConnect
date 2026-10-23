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

## Recepción por Flutter

`mobile-main.cjs` sirve únicamente `/config`, `/offer/correct` y `/result/correct`
en loopback (8793), con límite de cuerpo y duración. Se transpila
`mobile-renderer.ts` a `out/mobile.js` y se crea `out/mobile.html` que lo cargue.
Ejecutar Electron con `mobile-main.cjs --work=/ruta/privada --route=direct|udp|tls`,
copiar `mobile-test.dart` a `integration_test/stream_quality_test.dart` de una
copia aislada de `mobile/` y ejecutar `flutter test` sobre un simulador/emulador.
El test usa los analizadores, PBKDF2/HMAC y muestreador del producto, confirma los
tres perfiles y verifica recepción, dimensiones y ruta. El host artificial usa
la clave pública del vector de pruebas, nunca una cuenta o contraseña real.
No emplear este servidor como host ni publicarlo en una interfaz de red externa.

## Captura real en la VM Windows

`windows-main.cjs` muestra una ventana propia con texto artificial y captura el
display principal mediante `desktopCapturer`/`getDisplayMedia`, con Electron
39.8.5 oficial. No genera entrada, guarda imágenes ni contacta con la API. El
receptor WebRTC está en el mismo proceso de laboratorio, sin servidores ICE.
La captura sí abarca la pantalla de la VM; no ejecutar sobre datos sensibles.

```sh
npx esbuild prototypes/remote-desktop/stream-quality-check/windows-renderer.ts --bundle --platform=browser --outfile=prototypes/remote-desktop/stream-quality-check/out/windows-capture.js
cp prototypes/remote-desktop/stream-quality-check/windows-*.html prototypes/remote-desktop/stream-quality-check/out/
```

Copiar `windows-main.cjs`, `preload.cjs` y `out/` a una carpeta nueva protegida
en la VM. Ejecutar como el usuario interactivo ordinario, nunca como SYSTEM:
`electron.exe windows-main.cjs --work=C:\ruta\privada\nueva`. `work` debe existir
y no contener `windows-capture-result.json`. El diagnóstico dura menos de 100
segundos, cierra sus ventanas y escribe únicamente métricas. Si se usa una tarea
temporal, debe tener `InteractiveToken`, `RunLevel=Limited`, límite de dos
minutos y retirarse después de verificar que no quedan procesos propios. No
requiere reglas nuevas de cortafuegos ni cambios de UAC.

Comprueba `native → balanced → smooth → native` sobre la misma pista: máximos,
proporción, ausencia de ampliación, recuperación de resolución y recepción de
vídeo. En la VM QEMU Windows 11 ARM, ejecutando Electron x64 por emulación,
la fuente de 1024×768 pasó a 960×720 en suave y volvió a 1024×768. Los cuatro
casos recibieron 3,7–3,9 fps. No se ha identificado la causa de ese límite;
no equivale al rendimiento de Windows físico ni demuestra resolución 1080p,
entrada del sistema, autenticación del producto o conexión desde otra red.
