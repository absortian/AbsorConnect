# Proposal

## Why

Absor Connect solo sabe hablar con almacenamiento S3. Para que sea la herramienta de conexiones remotas que promete el nombre, el primer paso es poder gestionar archivos en servidores por SSH (SFTP) con el mismo doble panel y la misma cola de transferencias que ya funcionan con S3. Este change introduce además el tipo de conexión "SSH", que reutilizará el change de terminal (`add-ssh-terminal`).

## What Changes

- **Nuevo tipo de conexión "SSH"**: host, puerto (22 por defecto), usuario y autenticación por **contraseña** o por **clave privada** (ruta a un fichero, con passphrase opcional). Directorio inicial opcional.
- El formulario de conexión permite elegir el tipo **S3** o **SSH** y muestra los campos de cada uno.
- Las conexiones existentes (sin tipo) se siguen tratando como **S3**, sin migración visible para el usuario.
- La contraseña y la passphrase se guardan cifradas como las claves de S3. La clave privada **no** se copia a la app: solo se guarda su ruta.
- **Explorador SFTP** en el panel derecho cuando la conexión activa es SSH: navegar por directorios, subir y descargar (arrastrando entre paneles o con el menú contextual), crear carpetas y borrar archivos y carpetas (recursivo), con progreso en la cola de transferencias.
- La cola de transferencias y el arrastre entre paneles pasan a trabajar con un **destino remoto genérico** (S3: bucket + prefijo; SFTP: ruta) en lugar de asumir un bucket.
- Exportar e importar conexiones conserva el tipo y los campos SSH.
- **Arreglo:** arrastrar archivos desde el sistema operativo al panel remoto. Hoy no funciona en S3 porque `File.path` ya no existe en Electron ≥ 32. Se expone `webUtils.getPathForFile` desde el preload y lo usan tanto el explorador SFTP como el S3.
- Los textos de bienvenida dejan de hablar solo de S3.

## Fuera de alcance

- Terminal SSH interactiva (change `add-ssh-terminal`).
- **Verificación de la host key**: por decisión explícita, la app acepta cualquier host key sin comprobarla (ver Riesgos en design.md). Queda como posible change futuro.
- Autenticación por agente SSH (ssh-agent/Pageant), certificados, 2FA más allá de keyboard-interactive con la contraseña, jump hosts y proxies.
- Renombrar, mover, cambiar permisos (chmod) o editar archivos remotos. Tampoco hay sincronización de carpetas ni transferencias en paralelo (la cola sigue procesando de una en una).
- Leer `~/.ssh/config`.
- Refactorizar `S3Explorer` en un explorador genérico. El explorador SFTP es un componente propio.

## Impacto en usuarios existentes

- **Datos:** `connections.json` gana un campo `type`. Las entradas antiguas sin `type` se leen como S3 y conservan sus credenciales. Al guardar, se escriben con `type: "s3"`. Si un usuario vuelve a una versión anterior, esta ignora el campo `type` y sigue funcionando con las conexiones S3. Las SSH aparecerían como S3 rotas, y es aceptable.
- **Credenciales:** mismo mecanismo de cifrado (`safeStorage`) y misma carpeta `userData`.
- **Auto-update:** ninguno.
- **Exportaciones antiguas:** importar un fichero exportado por la v0.0.7 sigue funcionando, porque las entradas sin tipo se tratan como S3.

## Capabilities

### New Capabilities
- `connection-management`: tipos de conexión (S3 y SSH), sus campos y métodos de autenticación, persistencia con cifrado de secretos, compatibilidad con conexiones existentes, e importación y exportación.
- `sftp-explorer`: explorar y gestionar archivos de un servidor SSH por SFTP en el doble panel, con transferencias en la cola común.

### Modified Capabilities
(ninguna: `app-identity` y `app-updates` no cambian)

## Impact

- **Dependencias nuevas:** `ssh2` (cliente SSH y SFTP en el proceso principal; sus dependencias nativas `cpu-features` y `nan` son opcionales) y `@types/ssh2` (dev).
- **Shared:** `src/shared/types.ts` pasa a un modelo de conexión con tipo (unión discriminada S3 / SSH / carpeta).
- **Main:** nuevo `src/main/ssh.ts` (gestor de conexiones SSH y operaciones SFTP), `store.ts` (cifrado por tipo y normalización de entradas sin tipo) e `index.ts` (canales IPC `sftp-*` y validación del import).
- **Preload:** métodos y tipos `sftp*`, y `getPathForFile` (con `webUtils`).
- **Renderer:** `ConnectionsSidebar.tsx` (formulario por tipo e icono por tipo), nuevo `SftpExplorer.tsx`, `App.tsx` (elige el explorador según el tipo), `LocalExplorer.tsx` y `TransferQueueContext.tsx` (destino remoto genérico), `S3Explorer.tsx` (soltar desde el SO y payload de arrastre), `TransferQueueBar.tsx` y locales en/es.
