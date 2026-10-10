# Tasks

## 1. Dependencias y modelo compartido

- [ ] 1.1 Añadir `ssh2` (dependencia) y `@types/ssh2` (dev) con `npm install`. Verificar: `npm ls ssh2` muestra la 1.17.x y `npm run typecheck` sigue pasando.
- [ ] 1.2 En `src/shared/types.ts`, definir la unión discriminada `S3Connection | SshConnection | FolderEntry` (`ConnectionEntry`) según D1, y actualizar todas las firmas que hoy usan `S3Connection` para listas de entradas. Verificar: `npm run typecheck` pasa.
- [ ] 1.3 Crear `src/shared/connections.ts` con `normalizeEntry` (sin tipo → S3; tipo desconocido o campos obligatorios ausentes → error) y la tabla de campos secretos por tipo. Verificar: con un script `node --experimental-strip-types` o desde la consola de `npm run dev`, una entrada v0.0.7 se normaliza a `type: 's3'` y una `{type:'ftp'}` lanza error.

## 2. Main

- [ ] 2.1 En `store.ts`, normalizar las entradas al leer y cifrar y descifrar los secretos según el tipo (D2). Verificar: con un `connections.json` de la v0.0.7 en una carpeta de datos temporal (`--user-data-dir`), las conexiones cargan como S3 y se descifran. Una conexión SSH guardada no tiene `password` ni `passphrase` en claro en el fichero.
- [ ] 2.2 Crear `src/main/ssh.ts` con el pool de conexiones, la autenticación por contraseña (con keyboard-interactive) y por clave privada (expansión de `~`, passphrase, errores `SSH_KEY_*`), timeouts, keepalive y el mapeo de errores a códigos (D4). Cerrar el pool en `before-quit`. Verificar: contra el servidor de pruebas (6.2), conecta con contraseña y con clave, y devuelve `SSH_AUTH_FAILED`, `SSH_UNREACHABLE` y `SSH_TIMEOUT` en los casos correspondientes.
- [ ] 2.3 Implementar en `ssh.ts` las operaciones SFTP: home, listar (con enlaces simbólicos y ocultos), crear carpeta, borrado recursivo sin seguir enlaces, y subir y descargar con progreso (D5). Verificar: cada operación funciona contra el servidor de pruebas desde la app (tareas 6.x).
- [ ] 2.4 En `index.ts`, registrar los canales `sftp-*` y `show-open-file-dialog` (con `~/.ssh` por defecto), y validar el import con `normalizeEntry` (D10). Verificar: `npm run typecheck:node` pasa, e importar un JSON con `{"type":"ftp"}` devuelve error sin cambiar las conexiones.

## 3. Preload

- [ ] 3.1 Exponer en `src/preload/index.ts` los métodos `sftp*`, `showOpenFileDialog` y `getPathForFile` (con `webUtils`), con sus tipos en `index.d.ts`. Cambiar los tipos de conexión a `ConnectionEntry`. Verificar: `npm run typecheck` pasa.

## 4. Renderer

- [ ] 4.1 `ConnectionsSidebar.tsx`: selector de tipo al crear, campos SSH, método de autenticación, selector de clave y passphrase, validación de obligatorios e icono por tipo en la lista (D9). Verificar: con `npm run dev` se crea y edita una conexión de cada tipo, y al editar no se puede cambiar el tipo.
- [ ] 4.2 `TransferQueueContext.tsx`: `bucket` opcional y despacho por `conn.type` a S3 o SFTP (D6). Verificar: las subidas a S3 siguen funcionando y las de SFTP llegan al servidor de pruebas.
- [ ] 4.3 Crear `SftpExplorer.tsx` (D7): navegación, ruta actual, selección múltiple, menú contextual, nueva carpeta, borrar con confirmación, soltar para subir (panel local y SO), arrastrar para descargar (`application/x-sftp-files`), recarga tras transferencias, y errores con "Reintentar". Verificar: los escenarios de `specs/sftp-explorer/spec.md` contra el servidor de pruebas.
- [ ] 4.4 `App.tsx` y `LocalExplorer.tsx`: `remoteLocation` genérico, elección del explorador por tipo, y que el panel local acepte el arrastre desde SFTP y suba al destino remoto activo (D6). Verificar: el botón de subir del panel local funciona con S3 y con SFTP, y el arrastre de SFTP al panel local descarga.
- [ ] 4.5 `S3Explorer.tsx`: soltar desde el SO con `window.api.getPathForFile` (D8). Verificar: arrastrar un archivo desde el Finder o el Explorador al panel S3 crea una subida en la cola (hoy no hace nada).
- [ ] 4.6 Textos en `locales/en.json` y `es.json`: formulario SSH, errores `SSH_*`/`SFTP_*`, explorador SFTP y bienvenida sin mencionar solo S3. Verificar: con la app en en y en es no aparece ninguna clave i18n sin traducir.

## 5. Documentación

- [ ] 5.1 README: añadir SFTP a características y stack (`ssh2`), y una nota de seguridad que diga que la host key no se verifica. Verificar: lectura del README renderizado.

## 6. Verificación

- [ ] 6.1 `npm run typecheck` pasa y los ficheros nuevos o tocados no añaden errores de lint respecto a `main` (comparar con `npx eslint <ficheros> -f json`).
- [ ] 6.2 Levantar un servidor SSH de pruebas en OrbStack: `docker run -d --name sftp-test -p 2222:2222 -e USER_NAME=test -e USER_PASSWORD=test -e PASSWORD_ACCESS=true -e PUBLIC_KEY="$(cat <clave>.pub)" lscr.io/linuxserver/openssh-server`, con una clave ed25519 de prueba con passphrase. Verificar: `ssh -p 2222 test@localhost` funciona con contraseña y con la clave.
- [ ] 6.3 (manual, `npm run dev`) Recorrer los escenarios de `specs/sftp-explorer/spec.md` contra el servidor de pruebas: home, directorio inicial, navegación, directorio sin permisos (`chmod 000`), subida múltiple, sobrescritura, descarga por arrastre y por menú, crear carpeta, borrado recursivo y cancelar el borrado.
- [ ] 6.4 (manual) Errores: host inexistente (`SSH_UNREACHABLE`), puerto filtrado (`SSH_TIMEOUT`), contraseña errónea (`SSH_AUTH_FAILED`), ruta de clave inexistente (`SSH_KEY_UNREADABLE`), y parar el contenedor durante una subida grande (la cola queda en error y el reintento funciona al volver a arrancarlo).
- [ ] 6.5 (manual) Compatibilidad: abrir la app con un `connections.json` de la v0.0.7 (conexiones S3 intactas), exportar e importar con una conexión SSH (ida y vuelta) e importar un JSON con un tipo desconocido (error sin cambios).
- [ ] 6.6 Empaquetado: `npm run build:mac` y abrir la app empaquetada contra el servidor de pruebas. En Linux (VM de OrbStack) y Windows (workflow temporal en GitHub Actions), construir e instalar el paquete y comprobar que una conexión SSH a un host inexistente devuelve `SSH_UNREACHABLE` (prueba de que `ssh2` carga en el paquete), y en Linux también que lista el servidor de pruebas.

## Workflow follow-up

- Archivar el change (`/opsx:archive`) cuando todo esté verificado, para que `connection-management` y `sftp-explorer` pasen a `openspec/specs/`.
