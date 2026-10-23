# Verificación — 23/10/2026

## Estado previo a la publicación

- TypeScript: `npm run typecheck` correcto.
- Vitest: 167 pruebas correctas, 5 omitidas preexistentes.
- Flutter: `flutter analyze` sin incidencias; 50 pruebas correctas con el entorno
  local de API, SSH y S3 de `mobile/tool/test_env.sh`.
- ESLint: sin errores en los archivos TypeScript tocados.
- Build Electron/Vite de producción correcto.
- PHPUnit: 162 pruebas, 1077 aserciones, PHP 8.5.12.
- Matriz CI inicial 138ae10: Windows, macOS arm64/x64, Linux, APK firmado e IPA
  sin firma correctos; cambios finales de cierre de captura se validan otra vez.
- OpenSpec: validación estricta correcta.
- Casos negativos nuevos: versiones/perfiles inválidos, host anterior, petición
  antes de autorización, cierre durante adquisición/replaceTrack, restauración
  tras rechazo, orden de operaciones, contadores reiniciados/no finitos y
  getStats fallido/solapado/tardío.

La revisión del plugin nativo confirma que StatsReport.timestamp procede de
`timestamp_us` en Darwin y Android. El muestreador móvil convierte a ms antes
de calcular kbit/s/fps por intervalo; las pruebas usan esas unidades nativas.
Los índices de entrada siguen normalizados: no se ha modificado su protocolo.

## Vídeo artificial

Instrumentación reproducible en
`prototypes/remote-desktop/stream-quality-check/`. No captura escritorios ni
inyecta entrada del sistema. Fuente artificial dimensionada por perfil;
configurador de vídeo de producción, transceptores recvonly y replaceTrack.
No verifica el escalado específico de getDisplayMedia de Windows/Mac/X11.

Primeras comparaciones Chromium receptor, 12 intervalos por caso:

| Ruta | Original 4K | Equilibrado 1080p | Fluido 720p |
|---|---:|---:|---:|
| Directa: fps decodificados | 28,1 | 29,2 | 29,6 |
| Directa: búfer medio ms | 168,9 | 37,4 | 19,5 |
| Techo codificador 1 Mbit/s: fps | 11,1 | 28,7 | 29,4 |
| Techo codificador 1 Mbit/s: búfer ms | 90,3 | 24,2 | 10,8 |

El techo del codificador no simula ni mide el ancho de banda de Internet. Las
muestras contienen variación y hubo una congelación en Original y Equilibrado
con ese techo, ninguna en Fluido. No prueban la causa del episodio histórico.

Recepción real Flutter/iPad Simulator con el plugin nativo, tras corregir las
unidades, con autenticación PBKDF2/HMAC, cambios confirmados y ruta verificada:

| Receptor / ruta | Original 4K fps | Equilibrado 1080p fps | Fluido 720p fps |
|---|---:|---:|---:|
| Flutter directa | 16,5 | 29,5 | 29,4 |
| Flutter TURN UDP | 16,1 | 29,6 | 29,4 |
| Flutter TURN TLS | 15,5 | 28,9 | 29,4 |
| Chromium TURN TLS | 29,4 | 29,3 | 29,4 |
| Chromium TURN UDP, repetición aislada | 29,3 | 18,3 | 29,4 |

En UDP, Equilibrado no mantuvo 30 fps: una primera ejecución obtuvo 13,8 fps y
la repetición aislada 18,3, con cinco congelaciones, búfer medio 295 ms y descenso
de la estimación de ancho de banda de WebRTC. Al final se recuperó hasta 29 fps.
No hubo pérdida de paquetes contabilizada; esto no descarta colas o congestión.
Fluido conservó unos 29 fps, con reducción adicional de resolución en algunas
muestras. El experimento de cambiar el hint de Equilibrado a motion dio 29 fps
pero redujo 1080p a 640×360, así que se mantiene detail para la legibilidad y
se ofrece Fluido como elección explícita. No se promete fluidez uniforme en
cada ruta. Las cifras y tamaños completos están en `synthetic-results.json`.

TURN temporal, procesos y servidor loopback se retiraron al acabar cada ruta.
Una repetición de Flutter topó con el límite de autenticación del entorno de
pruebas; al limpiar solo cache_items de desarrollo, la batería completa volvió
a pasar (50/50). No se cambiaron límites del servicio de producción.

La segunda matriz detectó un supuesto temporal en una prueba previa de
transferencias: esperaba solo 50 ms para confirmar dos archivos en Windows.
Se sustituyó esa espera fija por una condición acotada a la confirmación de
ambos archivos, conservando las aserciones de contenido y resumen. No cambió
el protocolo de ficheros. La compilación final y publicación siguen pendientes
de terminar.

## Límites de esta entrega

No certifica una conexión perfecta, ni reproduce el iPad y Windows físicos.
Android/iOS son controladores de PCs. El host sigue necesitando sesión gráfica;
el agente privilegiado, UAC e inicio de sesión conservan sus tareas pendientes
en `add-unattended-admin-access`. Mac mantiene distribución ad-hoc, actualización
manual e IPA sin firma para iOS.

## Publicación y recuperación

La versión candidata es 0.4.1. Los builds Windows/macOS/Linux del PR y Android/iOS
son la puerta de publicación. El tag prepara una release en borrador; no cambia
la última versión pública hasta completar los cinco destinos y fuente AltStore.
Antes de publicarla se verificará el resultado de CI y después sus assets,
manifiestos y salud HTTPS. Para retirar una versión, volver a borrador 0.4.1 y
restablecer 0.4.0 como latest; no hay migraciones de datos/API en esta entrega.

## Matriz final del PR 18

Commit verificado `e361dc26781dea4550d226e30d7806df1b622cfe`:

- Release PR run 40020116073: builds Windows, macOS y Linux correctos, con
  typecheck y 167 Vitest en la matriz. Publicación omitida por ser PR.
- Mobile PR run 40020116067: APK firmado y verificado, IPA sin firma correctos.
- Comprobados los cinco jobs terminados correctamente antes de fusionar.

La retirada de una release cambia la oferta de actualización; no degrada
automáticamente instalaciones que ya estén en 0.4.1. Para esas instalaciones
se precisa reinstalar 0.4.0 o publicar una corrección con versión superior.

## Versión publicada y verificada

[Release 0.4.1](https://github.com/absortian/AbsorConnect/releases/tag/v0.4.1),
fusionada mediante PR 18. Tag en `35ed4b60a18b7e5a5a5f57d72a5c91e36df56a6f`.
Run Release 40021035085 / número 22: los cinco builds y mobile-publish correctos.
La release se hizo pública solo después de adjuntar APK, IPA y fuente AltStore.
GitHub la devuelve como latest, sin marca draft/prerelease.

- Descargados los 20 assets públicos completos: tamaños y SHA-256 coinciden con
  sus digests de GitHub. `publication-results.json` contiene los resultados.
- Los tres manifiestos latest*.yml indican 0.4.1; comprobados los ocho hashes
  SHA-512 y tamaños de sus archivos referenciados contra las descargas reales.
- APK: apksigner correcto; conserva el mismo certificado SHA-256 que 0.4.0.
  Package com.absor.connect, versión 0.4.1, versionCode 22.
- IPA: versión/build 0.4.1/22, bundleIdentifier, tamaño y los tres textos de
  privacidad coinciden con la fuente AltStore publicada.
- Paquetes Mac: binarios arm64/x64 correctos y módulos koffi de su arquitectura
  desempaquetados. Los dos app.asar, APK e IPA contienen la extensión de perfiles.
- Cabeceras de NSIS/DEB/RPM/AppImage/DMG correctas. La instalación funcional en
  cada equipo físico sigue siendo parte de la matriz posterior, no de esta lectura.
- HTTPS producción: /api/health devuelve 200/status ok y la landing 200. La web
  resuelve las descargas con releases/latest; el enlace estable de AltStore ya
  devuelve 0.4.1. No hace falta desplegar otra imagen PHP para esta entrega.

Esta entrega de fluidez está completa (8/8 tareas). No cierra ni certifica el
cambio separado add-unattended-admin-access. Mac sigue requiriendo actualización
manual por firma ad-hoc; iOS sigue distribuyéndose como IPA sin firmar.
