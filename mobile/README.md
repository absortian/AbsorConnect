# Absor Connect para Android e iPhone

App de Flutter con la misma cuenta y las mismas conexiones que el escritorio: explorador SFTP y S3 (subir desde Archivos o Fotos, descargar y compartir, crear carpetas, borrar), terminal SSH con barra de teclas y control remoto de los PCs de la cuenta. Usuarios finales: instrucciones de instalación en [absorconnect.absor.top](https://absorconnect.absor.top/#descargas).

No hay cuenta de Google Play ni de Apple Developer, así que la app no está en las tiendas:

- **Android:** APK firmado con una clave propia, descargable desde la web y la release de GitHub. La app avisa en Ajustes cuando hay una versión nueva.
- **iPhone:** IPA **sin firmar** que SideStore, AltStore Classic o Sideloadly firman con el Apple ID de cada persona. Con un Apple ID gratuito la app caduca a los 7 días (SideStore y AltStore Classic la renuevan solos) y hay un máximo de 3 apps instaladas así. La fuente es `altstore-source.json` en la última release (formato de AltStore, que también lee SideStore).
- **Sin ordenador con AltStore Classic 2.3+:** en sus ajustes, "Remote AltServer" (con la VPN local LocalDevVPN) instala y renueva las apps desde el propio dispositivo. Como servidor se puede elegir el nuestro, `https://anisette.absor.top` (ver `kube/AGENTS.md`), en vez de los de la comunidad.
- **AltStore PAL no sirve:** la versión de AltStore para la UE (la que se instala sin ordenador) solo instala apps notarizadas por Apple y rechaza la fuente con «missing a marketplaceID». Notarizar exige la cuenta de Apple Developer de pago.

## Estructura

| Ruta | Contenido |
|---|---|
| `lib/src/api.dart`, `session.dart` | Cliente de la API y sesión (token en el almacén seguro: Keychain / Keystore) |
| `lib/src/connections.dart` | Lista de conexiones de la cuenta: guardado con revisión, aviso de conflicto (409) y refresco al volver a la app |
| `lib/src/keys.dart` | Claves privadas SSH importadas en cada dispositivo; en la cuenta solo se guarda el nombre del fichero |
| `lib/src/ssh.dart`, `remote_fs.dart`, `terminals.dart` | Una conexión SSH por servidor compartida por el explorador SFTP y las terminales |
| `lib/src/s3.dart` | Cliente S3 propio (firma SigV4, rutas tipo path) |
| `lib/src/updates.dart` | Aviso de versión nueva en Android (API de releases de GitHub) |
| `lib/src/remote/` | Control remoto: protocolo v1, prueba de la contraseña del PC, sesión WebRTC (`flutter_webrtc`), ficheros y portapapeles. Es el mismo protocolo que el visor de escritorio (`src/shared/remote/`) |
| `lib/ui/` | Pantallas |
| `lib/l10n/` | Textos en español e inglés (`app_es.arb`, `app_en.arb`) |

## Desarrollo

Requisitos: Flutter 3.47, JDK 21 y el SDK de Android (con un emulador) y, para iOS, Xcode. En macOS con Homebrew:

```bash
brew install --cask flutter android-commandlinetools
brew install openjdk@21
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0" "emulator" "system-images;android-36;google_apis;arm64-v8a"
avdmanager create avd -n absorconnect -k "system-images;android-36;google_apis;arm64-v8a"
flutter config --android-sdk "$ANDROID_HOME" --jdk-dir "$JAVA_HOME"
```

La app usa la API de producción salvo que se compile con otra:

```bash
# Backend de desarrollo (docker compose en la raíz); el emulador llega al Mac por 10.0.2.2
flutter run --dart-define=API_URL=http://10.0.2.2:8020
```

Tras cambiar un `.arb`, `flutter gen-l10n` (o cualquier `flutter run`/`build`) regenera `lib/l10n/app_localizations.dart`. El icono sale de `assets/icon.png` con `dart run flutter_launcher_icons`.

## Pruebas

`tool/test_env.sh` levanta el backend de desarrollo, un servidor SSH (`sftp-test`, puerto 2222, usuario y contraseña `test`, más una clave con passphrase) y un servidor S3 que valida las firmas (`s3-test`, Versity Gateway en el 7070, bucket `pruebas`), e imprime las variables que leen las pruebas:

```bash
eval "$(tool/test_env.sh)"
flutter analyze
flutter test
```

Recorrido completo en el emulador (registro, conexiones, SFTP, terminal, S3 y cierre de sesión), con capturas en `SHOTS_DIR` o `build/shots`:

```bash
flutter drive --driver=test_driver/integration_test.dart --target=integration_test/app_test.dart --dart-define=API_URL=http://10.0.2.2:8020 --dart-define=TEST_HOST=10.0.2.2
```

Al acabar: `docker rm -f sftp-test s3-test` y `docker compose down` en la raíz.

## Control remoto

"Equipos" (icono de la pantalla de inicio) muestra los PCs de la cuenta, con su estado, y conecta con los que están disponibles. Pide la contraseña de control remoto del PC; la contraseña no se guarda, solo K (derivada de ella) mientras dura la sesión, para reconectar sin volver a pedirla.

- **Gestos:**
  - modo ratón (trackpad): un dedo mueve el puntero, tocar es clic, dos dedos a la vez son clic derecho, y mantener pulsado y mover arrastra;
  - modo táctil: tocar hace clic ahí, mantener pulsado es clic derecho y arrastrar con un dedo arrastra;
  - en los dos: dos dedos desplazan, y el pellizco hace zoom en el móvil.
- **Teclado:** el del teléfono envía texto; la barra de teclas tiene Esc, Tab, Supr, flechas, teclas de función y modificadores de un toque (Ctrl y después "c" es Ctrl+C).
- **Barra de arriba:** pantallas del PC, sonido, enviar el portapapeles, enviar ficheros o fotos y descargar del PC (a la hoja de compartir). Lo que copia el PC se puede pegar en el teléfono.
- **Segundo plano:** la sesión aguanta 30 s; al volver, sigue o se recupera sola. Pasado ese tiempo, se cierra.
- **PBKDF2 (600 000 iteraciones), en otro isolate para no congelar la interfaz:**
  - en iOS, CommonCrypto (por FFI);
  - en Android, `lib/src/remote/pbkdf2.dart`, en Dart: unos 0,75 s en el emulador. El `SecretKeyFactory` del sistema es BouncyCastle en Java: tarda más del doble y bloquea el hilo principal.
- **iOS:**
  - el sonido del PC se reproduce con una sesión de audio solo de reproducción;
  - `NSMicrophoneUsageDescription` está declarada por si WebRTC tocara el micrófono (sin ella, iOS cerraría la app). Como cualquier clave nueva, también va en la fuente de AltStore.

**Probar con el emulador.** Hace falta un PC de la misma cuenta con la app de escritorio y el control remoto activado, contra el mismo backend de desarrollo. El emulador llega al backend por 10.0.2.2 y al PC por su IP de la red local:

```bash
flutter run --dart-define=API_URL=http://10.0.2.2:8020
```

La prueba automática contra un PC de verdad es `prototypes/remote-desktop/mobile-check` (ver el README de los prototipos). En un solo Linux, el PC es la prueba entre dos equipos (`lan-check/pc.ts`) y el móvil, el emulador. Recorre:

- Equipos, la conexión con contraseña y girar el teléfono;
- mover el puntero, clic, clic derecho con dos dedos y el modo táctil;
- "Mañana" y Ctrl+C;
- el portapapeles en los dos sentidos y enviar una foto;
- volver tras 10 s y tras más de 30 s, y reconectar.

**Cuánto tarda PBKDF2 en un dispositivo** (con el móvil conectado): `flutter test integration_test/pbkdf2_test.dart -d <dispositivo>`. Escribe una línea `PBKDF2 {...}` con los tiempos. En un Mac, `prototypes/remote-desktop/mobile-check/test-mac.sh` lo hace con cada teléfono conectado, además de compilar la IPA y probar la ruta de CommonCrypto.

## Firma y publicación

`.github/workflows/mobile.yml` compila el APK (Ubuntu) y la IPA sin firmar (macOS) en cada PR que toca `mobile/`. En cada tag `v*`, `release.yml` lo llama con la versión del tag y adjunta a la release `absor-connect-<versión>.apk`, `absor-connect-<versión>.ipa` y `altstore-source.json`. El `versionCode` / `CFBundleVersion` es el número de ejecución del workflow, así que siempre crece.

**La clave de firma de Android no se puede perder ni cambiar:** Android solo instala una versión nueva encima de la anterior si está firmada con la misma clave; con otra, cada persona tendría que desinstalar la app (y perder sus claves privadas importadas). El keystore está en los secrets del repositorio (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`) y el propietario guarda una copia fuera de GitHub.

Para un APK de release firmado en local, `android/app/build.gradle.kts` lee la clave de las mismas variables (sin ellas usa la clave de depuración):

```bash
ANDROID_KEYSTORE_PATH=/ruta/absorconnect-android.jks ANDROID_KEYSTORE_PASSWORD=… ANDROID_KEY_ALIAS=absorconnect ANDROID_KEY_PASSWORD=… \
  flutter build apk --release
```

### Calidad y diagnóstico de vídeo

Si el PC anuncia la extensión de calidad del protocolo v1, la barra de control
ofrece **Equilibrado** (hasta 1920×1080), **Fluido** (hasta 1280×720) y
**Resolución original**. Se conserva toda la pantalla, su proporción y las
coordenadas normalizadas de entrada; no se recorta ni amplía la imagen. Los
perfiles limitan el vídeo a 30 fps. WebRTC adapta la transmisión a la conexión:
no garantizan 30 fps ni una latencia fija. El selector refleja la confirmación
del PC y recuerda la preferencia durante las reconexiones de esa sesión.

La barra muestra resolución recibida, fps, RTT del transporte, kbit/s de vídeo
recibido y tiempo medio del búfer de vídeo durante el último intervalo. El RTT
y el búfer no miden el tiempo entre una pulsación y su resultado visible.
Un dato ausente se omite. Son estadísticas locales en memoria, sin telemetría.
Un host anterior conserva su funcionamiento y no muestra el selector.
