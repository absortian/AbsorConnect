# Absor Connect para Android e iPhone

App de Flutter con la misma cuenta y las mismas conexiones que el escritorio: explorador SFTP y S3 (subir desde Archivos o Fotos, descargar y compartir, crear carpetas, borrar) y terminal SSH con barra de teclas. Usuarios finales: instrucciones de instalación en [absorconnect.absor.top](https://absorconnect.absor.top/#descargas).

No hay cuenta de Google Play ni de Apple Developer, así que la app no está en las tiendas:

- **Android:** APK firmado con una clave propia, descargable desde la web y la release de GitHub. La app avisa en Ajustes cuando hay una versión nueva.
- **iPhone:** IPA **sin firmar** que AltStore, SideStore o Sideloadly firman con el Apple ID de cada persona. Con un Apple ID gratuito la app caduca a los 7 días (AltStore/SideStore la renuevan solos) y hay un máximo de 3 apps instaladas así. La fuente de AltStore/SideStore es `altstore-source.json` en la última release.

## Estructura

| Ruta | Contenido |
|---|---|
| `lib/src/api.dart`, `session.dart` | Cliente de la API y sesión (token en el almacén seguro: Keychain / Keystore) |
| `lib/src/connections.dart` | Lista de conexiones de la cuenta: guardado con revisión, aviso de conflicto (409) y refresco al volver a la app |
| `lib/src/keys.dart` | Claves privadas SSH importadas en cada dispositivo; en la cuenta solo se guarda el nombre del fichero |
| `lib/src/ssh.dart`, `remote_fs.dart`, `terminals.dart` | Una conexión SSH por servidor compartida por el explorador SFTP y las terminales |
| `lib/src/s3.dart` | Cliente S3 propio (firma SigV4, rutas tipo path) |
| `lib/src/updates.dart` | Aviso de versión nueva en Android (API de releases de GitHub) |
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

## Firma y publicación

`.github/workflows/mobile.yml` compila el APK (Ubuntu) y la IPA sin firmar (macOS) en cada PR que toca `mobile/`. En cada tag `v*`, `release.yml` lo llama con la versión del tag y adjunta a la release `absor-connect-<versión>.apk`, `absor-connect-<versión>.ipa` y `altstore-source.json`. El `versionCode` / `CFBundleVersion` es el número de ejecución del workflow, así que siempre crece.

**La clave de firma de Android no se puede perder ni cambiar:** Android solo instala una versión nueva encima de la anterior si está firmada con la misma clave; con otra, cada persona tendría que desinstalar la app (y perder sus claves privadas importadas). El keystore está en los secrets del repositorio (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`) y el propietario guarda una copia fuera de GitHub.

Para un APK de release firmado en local, `android/app/build.gradle.kts` lee la clave de las mismas variables (sin ellas usa la clave de depuración):

```bash
ANDROID_KEYSTORE_PATH=/ruta/absorconnect-android.jks ANDROID_KEYSTORE_PASSWORD=… ANDROID_KEY_ALIAS=absorconnect ANDROID_KEY_PASSWORD=… \
  flutter build apk --release
```
