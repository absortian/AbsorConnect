# Tasks

## 1. Proyecto y herramientas

- [x] 1.1 Instalar Flutter, JDK 21 y el SDK de Android con un emulador (Homebrew + `sdkmanager`). Verificar: `flutter doctor` sin errores en Android.
- [x] 1.2 Crear `mobile/` (Flutter, `com.absor.connect`, Android e iOS), dependencias de D1, ARB `es`/`en`, tema de la marca, icono de la app y permisos de D9. Excluir `mobile/**` de electron-builder, ESLint y Prettier. Verificar: `flutter analyze` limpio y la app arranca en el emulador.

## 2. Cuenta y conexiones

- [x] 2.1 Cliente de la API, sesión en el almacén seguro y pantalla de acceso con errores por código (D2). Verificar con pruebas de integración contra el backend de desarrollo: registro, login, credenciales incorrectas, sesión recordada y 401.
- [x] 2.2 Lista de conexiones con carpetas, refresco al volver y al deslizar, alta, edición, mover y borrado con revisión y aviso de conflicto (D3). Verificar con pruebas: escenarios de "Conexiones sincronizadas", incluido el conflicto con otro "equipo".
- [x] 2.3 Claves privadas importadas por dispositivo (D4). Verificar: la clave no aparece en la lista guardada en la cuenta, y una conexión del escritorio pide importarla.

## 3. Explorador y terminal

- [x] 3.1 SSH: cliente compartido por conexión y explorador SFTP (listar, subir, descargar y compartir, crear carpeta, borrar) con barra de transferencias (D5). Verificar contra un servidor SSH de pruebas.
- [x] 3.2 Cliente S3 propio (D6) y explorador S3. Verificar con pruebas contra un servidor S3 que valida las firmas (Versity Gateway; las imágenes de MinIO ya no se publican): buckets, prefijos, subir, descargar, crear carpeta y borrar carpeta.
- [x] 3.3 Terminal SSH con barra de teclas, varias sesiones y reconexión (D5). Verificar: comando con salida, Ctrl+C, dos sesiones abiertas.
- [x] 3.4 Ajustes: cuenta, cerrar sesión (cierra SSH), versión y aviso de versión nueva en Android (D8). Verificar con prueba de integración.
- [x] 3.5 Endpoint S3 sin esquema, claves recortadas y errores de S3 comprensibles (redirección, certificado, endpoint inválido), publicado en la v0.3.1 (D6). Verificar: pruebas sin servidor, y solo lectura contra el MinIO del propietario desde el Mac y el emulador.

## 4. Distribución

- [x] 4.1 Keystore de Android y firma de release en Gradle a partir de variables de entorno; secrets en GitHub y copia en `CLAUDE_AUTH`. Verificar: `flutter build apk --release` firmado (`apksigner verify`) e instalación encima de la anterior en el emulador.
- [x] 4.2 `release.yml`: trabajos `android` e `ios` y generación de `altstore-source.json` (D8). Verificar: `actionlint` o equivalente, y una ejecución de prueba en una rama que no publique.
- [x] 4.3 Web: pestañas Android e iOS con ficheros, enlaces de AltStore/SideStore e instrucciones; detección de móvil. Verificar en escritorio y en móvil.
- [x] 4.4 Documentación: `mobile/README.md` (desarrollo, pruebas, firma), README raíz y `AGENTS.md`.
- [x] 4.5 iPhone sin AltStore PAL (v0.3.2): la web recomienda SideStore y AltStore Classic, avisa de que AltStore PAL no sirve, explica el error «AltServer could not be found», y la fuente lleva `nsfw`. Verificar: la fuente coincide con la IPA (bundle, versión, build, tamaño y permisos) y la web en el navegador.

## 5. Verificación y publicación

- [x] 5.1 Recorrer en el emulador de Android los escenarios de `mobile-app` contra el backend de desarrollo, con capturas.
- [x] 5.2 Publicar la v0.3.0 y comprobar: APK, IPA y fuente en la release, `latest*.yml` del escritorio intactos, la fuente con la versión correcta y la web listando los ficheros móviles.
- [x] 5.3 Instalar el APK publicado y usarlo con una cuenta de producción. En el emulador: se instala encima de la versión anterior, abre la pantalla de acceso y solo apunta a la API de producción. El propietario la usa en su Android con su propia cuenta, sin cuentas de prueba en producción.

## Workflow follow-up

- **Propietario:** probar la IPA en un iPhone con SideStore o AltStore Classic (no AltStore PAL).
- Archivar el change tras verificarlo.
