# Proposal

## Why

Desde la v0.2.0 las conexiones de cada persona viven en su cuenta. Eso permite llevarlas también al móvil: consultar un bucket, bajar un fichero de un servidor o abrir una terminal SSH desde el teléfono, con las mismas conexiones que en el escritorio. Todavía no hay cuentas de publicador de Apple ni de Google, así que las apps tienen que poder instalarse fuera de las tiendas.

## What Changes

- **App móvil nueva para Android e iOS** (`mobile/`, Flutter), con la misma cuenta y las mismas conexiones que la app de escritorio:
  - Iniciar sesión, crear cuenta y cerrar sesión, con la sesión recordada de forma cifrada en el dispositivo.
  - Ver, crear, editar, mover y borrar conexiones y carpetas, sincronizadas con la cuenta (con el mismo control de conflictos).
  - Explorador SFTP y S3: navegar, subir desde Archivos o Fotos, descargar y compartir, crear carpetas y borrar.
  - Terminal SSH con barra de teclas especiales (Esc, Tab, Ctrl, flechas) y varias sesiones abiertas.
  - Claves privadas importadas en cada dispositivo: su contenido nunca sale del teléfono.
- **Android sin Google Play:** APK firmado con una clave propia, que se instala desde la web. La app avisa cuando hay una versión nueva.
- **iOS sin cuenta de Apple Developer:** `.ipa` sin firmar y una fuente de AltStore/SideStore. Cada persona la instala con su propio Apple ID gratuito; AltStore/SideStore la renuevan cada 7 días y la actualizan.
- **Publicación conjunta:** la misma release de GitHub (tag `v*`) publica escritorio, APK, IPA y la fuente de AltStore.
- **Web:** pestañas Android e iOS en las descargas de `https://absorconnect.absor.top`, con las instrucciones de instalación.

## Fuera de alcance

- Publicar en Google Play o en la App Store (requiere las cuentas de publicador; el mismo código servirá).
- Explorador de archivos locales del teléfono y arrastrar entre paneles: en móvil se sube desde el selector del sistema y se descarga a la hoja de compartir.
- Verificación de la clave de host SSH (igual que en escritorio).
- Uso sin conexión.

## Impacto en usuarios existentes

- **Escritorio:** ninguno. La release incluye además los ficheros móviles, y el auto-update de escritorio solo lee `latest*.yml`.
- **Cuentas y conexiones:** las mismas. Las conexiones con clave privada creadas en el escritorio piden importar la clave en el móvil la primera vez; las creadas en el móvil guardan como ruta el nombre del fichero importado, que en el escritorio no existirá (mismo caso que entre dos ordenadores).
- **iOS:** sin cuenta de desarrollador, la app caduca a los 7 días si AltStore/SideStore no la renueva, y un Apple ID gratuito admite como mucho 3 apps instaladas así.

## Capabilities

### New Capabilities
- `mobile-app`: la app de Android e iOS (acceso con la cuenta, conexiones sincronizadas, claves privadas en el dispositivo, explorador SFTP y S3, terminal SSH).
- `mobile-distribution`: cómo se instalan y actualizan las apps móviles sin cuentas de publicador, y cómo se publican junto con el escritorio.

### Modified Capabilities
- Ninguna.

## Impact

- **Nuevo `mobile/`** (proyecto Flutter) y su documentación.
- **CI:** `.github/workflows/release.yml` con trabajos para el APK (Ubuntu) y la IPA (macOS), y la generación de la fuente de AltStore. Secrets nuevos con la clave de firma de Android.
- **Web:** `backend/public/index.html` (pestañas Android e iOS).
- **Exclusiones:** `mobile/**` fuera del paquete de Electron, de ESLint y de Prettier.
- **Sin cambios en el backend:** la app móvil usa la misma API.
