# Verificación — 23/10/2026

## Estado previo a la publicación

- TypeScript: `npm run typecheck` correcto.
- Vitest: 166 pruebas correctas, 5 omitidas preexistentes.
- Flutter: `flutter analyze` sin incidencias; 50 pruebas correctas con el entorno
  local de API, SSH y S3 de `mobile/tool/test_env.sh`.
- ESLint: sin errores en los archivos TypeScript tocados.
- Build Electron/Vite de producción correcto.
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

La primera recepción real Flutter/iPad Simulator con el plugin nativo obtuvo
vídeo 3840×2160, 1920×1080 y 1280×720, con autenticación PBKDF2/HMAC y cambio de
perfil confirmado. La repetición comprueba las métricas tras corregir unidades.
TURN UDP/TLS, matriz de compilación y publicación: pendientes de finalizar.

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
