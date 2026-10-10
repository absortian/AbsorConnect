# Proposal

## Why

La aplicación va a dejar de ser solo un explorador S3: las próximas versiones añaden conexiones SFTP y terminal SSH. El nombre "Absor S3 Explorer" ya no describe el producto, así que pasa a llamarse **Absor Connect**. Hay que hacerlo antes de esas funcionalidades para que salgan ya con la marca nueva. Además, los usuarios que tienen instalada la v0.0.7 no deben perder sus conexiones ni la actualización automática.

## What Changes

- Nombre visible de la app: "Absor S3 Explorer" / "Absor File Explorer" / "Absor Explorer" → **"Absor Connect"** en la ventana, la cabecera, la pantalla de bienvenida, los atajos, el instalador y los paquetes.
- Ejecutable de Windows `AbsorS3Explorer.exe` → `AbsorConnect.exe`, y nombres de los artefactos de release con el prefijo `absor-connect-`.
- Repositorio de GitHub `absortian/AbsorS3Explorer` → `absortian/AbsorConnect`: cambian la configuración de `publish`, las URLs de `package.json` y los enlaces de respaldo a la página de releases.
- Se **mantienen** los identificadores internos (`name: absor-file-explorer` en `package.json` y `appId: com.absor.fileexplorer`). De ellos dependen la carpeta de datos, la clave de cifrado de credenciales, la identidad del instalador de Windows y el paquete deb/rpm.
- El AppUserModelID de Windows deja de ser el `com.electron` heredado de la plantilla y pasa a ser el `appId` real.
- Se actualizan el README, el cuerpo de la release en CI y el título de la ventana.

## Fuera de alcance

- Conexiones SFTP y terminal SSH (changes posteriores: `add-sftp-connections` y `add-ssh-terminal`).
- Renombrar componentes o tipos internos que siguen siendo específicos de S3 (`S3Explorer`, `S3Connection`). Se tratarán al generalizar el modelo de conexiones en el change de SFTP.
- Nuevo icono o logo.
- Firma y notarización en macOS.
- Publicar la release (tag `v*`). Este change lo deja todo listo; cuándo se publica (sola o junto a SFTP/SSH) es una decisión aparte.

## Impacto en usuarios existentes

- **Datos y credenciales:** ninguno, porque se mantiene `name`. La carpeta `userData` (`absor-file-explorer`) y la clave de `safeStorage` siguen siendo las mismas, y las conexiones cifradas se leen igual.
- **Auto-update:** las instalaciones v0.0.7 consultan `absortian/AbsorS3Explorer`. Tras renombrar el repo, GitHub redirige y `electron-updater` sigue hasta 10 redirecciones. Hay que verificarlo con una instalación real antes de dar el cambio por bueno.
- **Windows:** al mantenerse el `appId`, la nueva versión se instala encima de la anterior y no queda duplicada.
- **macOS:** como no está firmado, la actualización es manual (DMG). Se instala "Absor Connect.app" y el antiguo "Absor S3 Explorer.app" queda en /Applications hasta que el usuario lo borre. Ambos comparten datos, así que las notas de la release lo indicarán.
- **Linux:** el paquete deb/rpm conserva el nombre `absor-file-explorer` y se actualiza en el sitio. Cambia el nombre visible en el menú del escritorio.

## Capabilities

### New Capabilities
- `app-identity`: nombre visible de la aplicación, identificadores estables entre versiones y continuidad de los datos de usuario (conexiones, credenciales y ajustes) al actualizar.
- `app-updates`: canal de actualización (origen de releases, comprobación y descarga, y enlace de respaldo a la página de releases) y su continuidad para instalaciones anteriores.

### Modified Capabilities
(ninguna, porque todavía no hay specs base en `openspec/specs/`)

## Impact

- **Empaquetado:** `electron-builder.yml` (`productName`, `win.executableName`, plantillas `artifactName`, `publish.repo`), `package.json` (`homepage`, `repository`) y `.github/workflows/release.yml` (cuerpo de la release).
- **Main:** `src/main/updater.ts` (`RELEASES_URL`) y `src/main/index.ts` (`setAppUserModelId`).
- **Renderer:** `src/renderer/index.html` (`<title>`), `src/renderer/src/locales/{en,es}.json` (`app.title`, `app.welcomeTitle`) y `src/renderer/src/components/SettingsPanel.tsx` (URLs de releases).
- **Documentación:** `README.md`.
- **Externo:** renombrar el repositorio en GitHub. Lo hace el propietario a mano y es la única acción irreversible del change.
- Sin dependencias nuevas.
