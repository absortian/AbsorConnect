# Tasks

## 1. Proyecto y herramientas

- [ ] 1.1 Instalar Flutter, JDK 21 y el SDK de Android con un emulador (Homebrew + `sdkmanager`). Verificar: `flutter doctor` sin errores en Android.
- [ ] 1.2 Crear `mobile/` (Flutter, `com.absor.connect`, Android e iOS), dependencias de D1, ARB `es`/`en`, tema de la marca, icono de la app y permisos de D9. Excluir `mobile/**` de electron-builder, ESLint y Prettier. Verificar: `flutter analyze` limpio y la app arranca en el emulador.

## 2. Cuenta y conexiones

- [ ] 2.1 Cliente de la API, sesión en el almacén seguro y pantalla de acceso con errores por código (D2). Verificar con pruebas de integración contra el backend de desarrollo: registro, login, credenciales incorrectas, sesión recordada y 401.
- [ ] 2.2 Lista de conexiones con carpetas, refresco al volver y al deslizar, alta, edición, mover y borrado con revisión y aviso de conflicto (D3). Verificar con pruebas: escenarios de "Conexiones sincronizadas", incluido el conflicto con otro "equipo".
- [ ] 2.3 Claves privadas importadas por dispositivo (D4). Verificar: la clave no aparece en la lista guardada en la cuenta, y una conexión del escritorio pide importarla.

## 3. Explorador y terminal

- [ ] 3.1 SSH: cliente compartido por conexión y explorador SFTP (listar, subir, descargar y compartir, crear carpeta, borrar) con barra de transferencias (D5). Verificar contra un servidor SSH de pruebas.
- [ ] 3.2 Cliente S3 propio (D6) y explorador S3. Verificar con pruebas contra MinIO: buckets, prefijos, subir, descargar, crear carpeta y borrar carpeta.
- [ ] 3.3 Terminal SSH con barra de teclas, varias sesiones y reconexión (D5). Verificar: comando con salida, Ctrl+C, dos sesiones abiertas.
- [ ] 3.4 Ajustes: cuenta, cerrar sesión (cierra SSH), versión y aviso de versión nueva en Android (D8). Verificar con prueba de integración.

## 4. Distribución

- [ ] 4.1 Keystore de Android y firma de release en Gradle a partir de variables de entorno; secrets en GitHub y copia en `CLAUDE_AUTH`. Verificar: `flutter build apk --release` firmado (`apksigner verify`) e instalación encima de la anterior en el emulador.
- [ ] 4.2 `release.yml`: trabajos `android` e `ios` y generación de `altstore-source.json` (D8). Verificar: `actionlint` o equivalente, y una ejecución de prueba en una rama que no publique.
- [ ] 4.3 Web: pestañas Android e iOS con ficheros, enlaces de AltStore/SideStore e instrucciones; detección de móvil. Verificar en escritorio y en móvil.
- [ ] 4.4 Documentación: `mobile/README.md` (desarrollo, pruebas, firma), README raíz y `AGENTS.md`.

## 5. Verificación y publicación

- [ ] 5.1 Recorrer en el emulador de Android los escenarios de `mobile-app` contra el backend de desarrollo, con capturas.
- [ ] 5.2 Publicar la v0.3.0 y comprobar: APK, IPA y fuente en la release, `latest*.yml` del escritorio intactos, la fuente con la versión correcta y la web listando los ficheros móviles.
- [ ] 5.3 Instalar el APK publicado en el emulador y entrar con una cuenta de producción (después se borra).

## Workflow follow-up

- **Propietario:** probar la IPA en un iPhone con AltStore o SideStore.
- Archivar el change tras verificarlo.
