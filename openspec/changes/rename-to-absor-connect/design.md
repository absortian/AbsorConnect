# Design

## Context

Ver proposal.md (Why). Hoy la aplicación tiene tres capas de identidad que dependen de campos distintos:

| Campo | Valor actual | De él depende |
|---|---|---|
| `package.json` → `name` | `absor-file-explorer` | `app.name` en runtime (el `package.json` no tiene `productName`, y electron-builder no lo inyecta salvo con `extraMetadata`) → carpeta `userData`, clave de `safeStorage`, carpeta de instalación en Windows, paquete deb/rpm y ejecutable en Linux |
| `electron-builder.yml` → `appId` | `com.absor.fileexplorer` | `CFBundleIdentifier` en macOS, GUID del instalador NSIS (UUIDv5 del appId) y AppUserModelID de los atajos en Windows |
| `electron-builder.yml` → `productName` | `Absor S3 Explorer` | nombre del `.app`, atajos, "Aplicaciones instaladas", entrada `.desktop` y título del DMG |

Además hay textos sueltos con nombres anteriores e inconsistentes: `<title>Absor File Explorer</title>`, `app.title` y `app.welcomeTitle` ("Absor Explorer") en los locales, README, el cuerpo de la release en CI y URLs del repo en `updater.ts` y `SettingsPanel.tsx`.

Comprobado en `node_modules` (electron-builder 26 y electron-updater 6.8):
- `NsisTarget`: `APP_GUID = UUID.v5(appId)`, y `APP_FILENAME` (carpeta de instalación) = `sanitizedName` (el `name`) en el instalador oneClick por usuario, que es el modo actual porque `nsis` no define `oneClick`.
- `LinuxPackager`: ejecutable = `sanitizedName` en minúsculas si no hay `executableName` global, y paquete fpm = `linuxPackageName` (del `name`).
- `builder-util-runtime/httpExecutor`: sigue redirecciones 3xx (máx. 10).

## Goals / Non-Goals

**Goals:**
- Cambiar solo la capa visible (`productName`, textos y artefactos) y la del repositorio, sin tocar la capa de datos ni la de identidad de instalación.
- Cero migraciones de datos: que la ruta de código de `store.ts` no cambie.

**Non-Goals:**
- Unificar los identificadores internos con la marca nueva (por ejemplo, `name: absor-connect`). Exigiría migrar `userData`, recifrar credenciales y gestionar duplicados de instalación, sin beneficio visible para el usuario.
- Renombrar símbolos de código (`S3Explorer`, `S3Connection`).

## Decisions

### D1. Mantener `name` y `appId`; cambiar solo `productName`

Se cambian `productName: Absor Connect` y `win.executableName: AbsorConnect`. Se mantienen `name: absor-file-explorer` y `appId: com.absor.fileexplorer`. No se añade `productName` al `package.json` ni se usa `extraMetadata.productName`, porque cambiaría `app.name` y con él `userData` y la clave de `safeStorage`.

- **macOS:** `app.name` sigue siendo `absor-file-explorer`, así que `userData` = `~/Library/Application Support/absor-file-explorer`, igual que ahora. La entrada del Llavero de `safeStorage` depende del nombre de la app, que no cambia, así que las credenciales cifradas se descifran igual. El bundle pasa a llamarse `Absor Connect.app` con el mismo `CFBundleIdentifier`. Como la app no está firmada, la actualización es manual y el `.app` antiguo queda en /Applications (ver Riesgos).
- **Windows:** el GUID NSIS (UUIDv5 de `appId`) no cambia, así que el instalador nuevo reconoce la instalación anterior, ejecuta su desinstalador (que borra los atajos viejos) e instala encima. La carpeta de instalación sigue siendo `%LOCALAPPDATA%\Programs\absor-file-explorer`; cambia el `.exe` a `AbsorConnect.exe`. `userData` = `%APPDATA%\absor-file-explorer`, sin cambios. La clave DPAPI de `safeStorage` vive en `Local State` dentro de `userData`, así que tampoco cambia.
- **Linux:** el paquete deb/rpm sigue llamándose `absor-file-explorer` (se actualiza en el sitio) y el ejecutable sigue siendo `absor-file-explorer`. Cambia `Name=` en el `.desktop` a "Absor Connect". `userData` = `~/.config/absor-file-explorer`, sin cambios. libsecret usa el nombre de la app, que tampoco cambia.

*Alternativa descartada:* `name: absor-connect` con migración (copiar `userData` en el primer arranque y descifrar con la clave antigua). En macOS, `safeStorage` no permite leer la entrada del Llavero de otro nombre de app, así que obligaría a pedir de nuevo los secretos o a montar un puente de descifrado. En Windows y Linux, además, duplicaría la instalación. Se descarta por coste y riesgo.

### D2. Nombres de artefactos con prefijo literal `absor-connect`

Hoy las plantillas usan `${name}`, que da `absor-file-explorer-0.1.0-setup.exe`. Se sustituye por un prefijo literal en `nsis`, `mac`, `dmg`, `appImage` y `rpm` (y se añade `deb` explícito): `absor-connect-${version}-setup.${ext}`, `absor-connect-${version}-${arch}.${ext}`, etc. `latest*.yml` referencia el fichero por nombre, así que el updater lo encuentra igual. El `name` del paquete deb/rpm no cambia porque sale de `linuxPackageName`, no del nombre del fichero.

*Alternativa descartada:* `${productName}` en las plantillas, porque los espacios ("Absor Connect") complican las URLs y los scripts.

### D3. Renombrar el repo en GitHub y apoyarse en la redirección

`publish.repo`, `homepage`, `repository.url` y las dos URLs de respaldo (`updater.ts` y `SettingsPanel.tsx`) pasan a `absortian/AbsorConnect`. Las instalaciones v0.0.7 llevan `owner: absortian, repo: AbsorS3Explorer` en su `app-update.yml`. Tras el renombrado, GitHub responde con 301 a la ruta nueva tanto en `github.com/.../releases.atom` y en las descargas como en `api.github.com`, y `httpExecutor` sigue esas redirecciones.

Para no repetir la URL de releases en dos sitios, `SettingsPanel.tsx` usará la que ya envía `updater.ts` o una constante compartida en `src/shared/`.

*Alternativas descartadas:*
- **Mantener el nombre del repo.** No tiene riesgo, pero la marca queda inconsistente en descargas y URLs.
- **Repo nuevo y "release puente" en el antiguo.** Es más robusto ante un futuro repo `AbsorS3Explorer`, pero duplica el CI y el historial.

### D4. AppUserModelID = `appId`

`electronApp.setAppUserModelId('com.electron')` → `setAppUserModelId('com.absor.fileexplorer')`. electron-builder ya asigna ese AUMID a los atajos que crea NSIS. Alinearlo hace que Windows agrupe la ventana con su atajo en la barra de tareas y atribuya bien las notificaciones.
- **macOS y Linux:** no aplica (es una llamada sin efecto fuera de Windows).

### D5. Versión

Este change no publica nada. Al cortar la release se recomienda `0.1.0` para marcar el rebranding, se publique sola o junto a SFTP/SSH.

## Risks / Trade-offs

- **[El Llavero de macOS usa otro nombre del que suponemos]** → Verificación explícita con un build empaquetado: guardar una conexión con la v0.0.7, instalar el build nuevo y conectar sin volver a introducir credenciales. Si falla, reabrir D1 antes de publicar.
- **[GitHub deja de redirigir si alguien crea un repo nuevo llamado `AbsorS3Explorer`]** → No reutilizar ese nombre. Documentarlo en el README (sección de historial).
- **[Redirección no seguida en algún paso del updater (atom, yml o binario)]** → Antes de renombrar, nada que hacer. Después, comprobar con `curl -sIL` cada URL. Al publicar la primera release, probar el update real desde una v0.0.7 en Windows. Si falla, se puede volver a llamar `AbsorS3Explorer` al repo, porque el renombrado es reversible mientras nadie ocupe el nombre.
- **[macOS: dos apps en /Applications]** → Ambas comparten datos y no se corrompen, pero solo la nueva se actualiza. Las notas de la release indicarán borrar "Absor S3 Explorer.app".
- **[Trade-off: identificadores internos con nombre antiguo]** → `absor-file-explorer` seguirá apareciendo en rutas de datos, en la carpeta de instalación de Windows y en el nombre del paquete Linux. Se acepta: no es visible en el uso normal y evita migraciones.

## Migration Plan

1. Mergear el change en `main` (código y configuración). No requiere migración de datos.
2. Renombrar el repo en GitHub (Settings → Rename → `AbsorConnect`) y actualizar el `origin` local (`git remote set-url origin https://github.com/absortian/AbsorConnect.git`).
3. Verificar las redirecciones (ver tasks).
4. Al publicar la release (tag `v0.1.0`), incluir en las notas el cambio de nombre y la instrucción de macOS.
5. **Rollback:** revertir el commit y, si hiciera falta, devolver el nombre `AbsorS3Explorer` al repo. Como no se tocan datos, las instalaciones no quedan en un estado inconsistente.
