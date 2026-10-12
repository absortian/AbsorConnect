# Design

## Context

Ver proposal.md (Why). La API y el formato de las conexiones son los de `add-cloud-backend` (D4); la app de escritorio ya los usa desde la v0.2.0.

En móvil no hay sockets TCP desde una web, así que SSH y SFTP necesitan código que corra en la app. Flutter tiene librerías maduras en Dart puro para ambos (sin plugins nativos que mantener en Swift y Kotlin) y genera las dos apps desde un solo código.

No hay cuentas de publicador:
- **Android** admite instalar APK de fuera de Google Play con un permiso del usuario. La firma la hacemos con una clave propia generada aquí.
- **iOS** solo admite apps firmadas por Apple. Sin cuenta de desarrollador, la única vía para otras personas es que cada una firme la app con su propio Apple ID (AltStore, SideStore o Sideloadly). Con un Apple ID gratuito la firma dura 7 días y caben 3 apps.

## Goals / Non-Goals

**Goals:**
- Una sola base de código (`mobile/`) para Android e iOS, con la misma cuenta y conexiones que el escritorio.
- Que las dos apps se puedan instalar y actualizar hoy, sin cuentas de publicador, y que el mismo código sirva para las tiendas cuando las haya.

**Non-Goals:**
- Replicar el doble panel del escritorio: en móvil hay una sola columna y los ficheros locales vienen del selector del sistema.
- Compartir código con la app de Electron (lenguajes distintos). Lo común es el contrato de la API y el formato de las conexiones.

## Decisions

### D1. Estructura y dependencias
`mobile/` es un proyecto Flutter (paquete `absor_connect`, identificador `com.absor.connect` en Android e iOS) dentro del monorepo. Se excluye del paquete de Electron, de ESLint y de Prettier.

| Necesidad | Paquete |
|---|---|
| SSH, SFTP | `dartssh2` (Dart puro) |
| Terminal | `xterm` (de los mismos autores que dartssh2) |
| Almacén seguro (token, claves privadas) | `flutter_secure_storage` (Keychain / Keystore) |
| API | `http` |
| S3 | Cliente propio con firma SigV4 (`crypto`), ver D6 |
| Ficheros | `file_picker` (subir), `share_plus` (compartir), `path_provider` |
| Varios | `package_info_plus`, `device_info_plus`, `url_launcher`, `flutter_localizations` |

El estado se maneja con `ChangeNotifier` y `ListenableBuilder` de Flutter, sin librerías de estado.

### D2. Sesión
- **Igual que el escritorio:** `POST /api/auth/login|register` con `deviceName` (modelo del teléfono) y token en el almacén seguro.
- **Sesión inválida:** cualquier 401 en una llamada autenticada borra el token y vuelve a la pantalla de acceso con aviso.
- **URL de la API:** `https://absorconnect.absor.top`, sobrescribible al compilar con `--dart-define=API_URL=…` (desarrollo: `http://10.0.2.2:8020` en el emulador de Android).

### D3. Conexiones
- **Lectura y escritura:** caché en memoria `{revision, entries}`; `GET` al entrar y `PUT` de la lista entera con la revisión. Las escrituras van en fila, como en el escritorio.
- **Conflicto:** un 409 recarga la lista con la que trae la respuesta y avisa.
- **Refresco:** al volver a la app tras más de 30 s y al deslizar hacia abajo.
- **Entradas:** se guardan como mapas JSON, conservando los campos que la app no conoce, igual que `normalizeEntry`.

### D4. Claves privadas en el dispositivo
- **Almacén:** el contenido de la clave se guarda en el almacén seguro con la clave `key:<id de conexión>`.
- **Lo que se sincroniza:** en la cuenta solo va `privateKeyPath`. Para conexiones creadas en el móvil es el nombre del fichero importado (por ejemplo `id_ed25519`).
- **Clave que falta:** al conectar con clave privada sin clave importada, la app pide el fichero (selector del sistema) y lo guarda antes de seguir.
- **La passphrase:** es un secreto normal de la conexión y se sincroniza cifrada, como en el escritorio.

### D5. SSH y SFTP
- **Una conexión por servidor:** se abre un `SSHClient` por conexión y lo comparten el explorador y las terminales (como el pool del escritorio). Se cierra al cerrar sesión.
- **Explorador SFTP:**
  - Listar, crear carpeta y borrar (las carpetas, de forma recursiva).
  - Descargar a una carpeta temporal y abrir la hoja de compartir.
  - Subir en streaming desde el fichero elegido.
- **Terminal:**
  - `TerminalView` de `xterm` sobre una `shell` de dartssh2 con PTY `xterm-256color` y redimensionado.
  - Barra de teclas: Esc, Tab, Ctrl (modificador de un toque), flechas, `|`, `/`, `~`, `-`.
  - Las sesiones abiertas se guardan en un gestor y se puede cambiar entre ellas desde la pantalla de terminales.
- **Clave de host:** se acepta cualquiera, como en el escritorio (non-goal documentado).

### D6. Cliente S3 propio
Un cliente pequeño (unas 300 líneas) sobre `http`, con firma SigV4 y estilo de ruta (`forcePathStyle`, como el escritorio):
- **Operaciones:** `ListBuckets`, `ListObjectsV2` con delimitador, `GetObject` en streaming, `PutObject` en streaming con `UNSIGNED-PAYLOAD`, `PutObject` vacío para "carpetas", y `DeleteObject` y `DeleteObjects` para borrar carpetas.
- **Endpoint y región:** el endpoint y la región son los de la conexión (región por defecto `us-east-1`). Un endpoint sin esquema se completa con `https://` al guardarlo y al usarlo (el escritorio ya exige la URL completa), y las claves se recortan por si se pegaron con un salto de línea.
- **Errores comprensibles:** las redirecciones no se siguen, porque la petición perdería la firma y S3 respondería "acceso denegado": el error dice adónde redirige el servidor. Los fallos de TLS tienen su propio código (`s3_tls_error`), y un error inesperado muestra su detalle. Se añadió en la v0.3.1, tras un fallo real con un MinIO propio.
- **Por qué no un paquete:** los clientes S3 de Dart disponibles o no permiten endpoints arbitrarios con estilo de ruta, o llevan tiempo sin mantenimiento. Este cubre justo lo que usa la app y se prueba contra un servidor S3 que valida las firmas (Versity Gateway).

### D7. Interfaz
- **Navegación:** acceso → lista de conexiones (con carpetas plegables) → explorador o terminal. Ajustes con la cuenta (email, cerrar sesión), la versión y la búsqueda de actualizaciones.
- **Estilo:** tema oscuro con el color de la marca (`#6366f1`), como el escritorio y la web.
- **Textos:** archivos ARB `es` y `en` con `gen-l10n`.
- **Transferencias:** barra inferior con progreso y error de cada una.

### D8. Distribución
- **Android:**
  - APK firmado con un keystore propio (`keytool`, RSA 4096, validez de 30 años).
  - El keystore y sus contraseñas van en secrets de GitHub (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`). Hay una copia en `CLAUDE_AUTH` del propietario: **perderlo impediría actualizar las instalaciones existentes**.
- **iOS:**
  - `flutter build ios --release --no-codesign` en un runner macOS de GitHub (trae Xcode), empaquetado como `.ipa` (carpeta `Payload/`).
  - AltStore, SideStore y Sideloadly la firman con el Apple ID de cada persona.
- **Fuente de AltStore/SideStore:**
  - `altstore-source.json` (formato de fuentes v2), generado en CI y publicado como fichero de la release.
  - URL estable: `https://github.com/absortian/AbsorConnect/releases/latest/download/altstore-source.json`.
- **Release:**
  - Dos trabajos nuevos en `release.yml`, `android` (Ubuntu) e `ios` (macOS), más la generación de la fuente.
  - La versión sale del tag (`--build-name`) y el número de compilación, del número de ejecución.
  - No tocan los `latest*.yml` del escritorio.
- **Aviso de versión en Android:** al arrancar se consulta `releases/latest` de GitHub; si hay una versión mayor con APK, aparece un aviso que abre su descarga en el navegador.
- **Web:** pestañas Android e iOS en descargas. Para iOS:
  - Enlaces `altstore://source?url=…` y `sidestore://source?url=…`, la IPA para Sideloadly y los límites de un Apple ID gratuito.
  - La detección de sistema distingue Android e iOS de escritorio.

### D9. Permisos
- **Android:** `INTERNET` en el manifiesto principal (la plantilla solo lo pone en depuración) y `usesCleartextTraffic` para endpoints S3 por HTTP, que el escritorio también admite.
- **iOS:**
  - `NSAppTransportSecurity › NSAllowsArbitraryLoads` (endpoints HTTP).
  - `NSLocalNetworkUsageDescription` (servidores de la red local).
  - `NSPhotoLibraryUsageDescription` (subir fotos).

## Risks / Trade-offs

- **[iOS caduca a los 7 días]** Con un Apple ID gratuito, si AltStore/SideStore no renueva la firma, la app deja de abrir. → La web lo explica; AltStore/SideStore la renuevan en segundo plano. La solución definitiva es la cuenta de desarrollador.
- **[Avisos de seguridad en Android]** Play Protect puede advertir de una app de desarrollador desconocido. → La web explica cómo continuar; desaparece si algún día se publica en Google Play.
- **[Clave de firma de Android]** Si se pierde, las actualizaciones ya no se instalan encima. → Copia en `CLAUDE_AUTH` y en secrets de GitHub.
- **[AltStore PAL]** La versión de AltStore para la UE, la que se instala sin ordenador, solo admite apps notarizadas por Apple: rechaza la fuente con «missing a marketplaceID». Notarizar exige la cuenta de Apple Developer. → La web recomienda SideStore y AltStore Classic y avisa de que PAL no sirve.
- **[iOS sin probar en simulador aquí]** Este Mac no tiene Xcode. → Se compila en CI. Se prueba en Android (misma base de código) y el propietario la prueba en un iPhone; si instala Xcode, también en el simulador.
- **[Cliente S3 propio]** → Cubierto con pruebas contra Versity Gateway, que valida las firmas (listar, subir, descargar, carpetas, borrar).

## Migration Plan

1. Mergear: no afecta a la web ni al escritorio hasta la siguiente release.
2. Crear el keystore y los secrets de GitHub.
3. Publicar la v0.3.0: escritorio, APK, IPA y fuente.
4. **Rollback:** borrar los ficheros móviles de la release o publicar una versión nueva; el escritorio no depende de ellos.
