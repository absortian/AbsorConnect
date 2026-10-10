# Design

## Context

Ver proposal.md (Why). Estado actual relevante:

- **Modelo:** `src/shared/types.ts` define un único `S3Connection` que también sirve para las carpetas (`isFolder: true`). Toda la app lo usa: store, IPC, preload, sidebar y exploradores.
- **Persistencia:** `store.ts` cifra campo a campo `accessKeyId` y `secretAccessKey` con `safeStorage` y marca `_encrypted: true`. `getConnections()` devuelve las conexiones descifradas al renderer, que es el patrón actual.
- **Transferencias:** `TransferQueueContext` procesa un trabajo cada vez. Busca la conexión por `connectionId` con `getConnections()` y llama a `uploadFile`/`downloadFile` de S3 con `job.bucket`. El progreso llega por el evento `transfer-progress`.
- **Doble panel:** `App.tsx` guarda `s3Location {bucket, prefix}` y se lo pasa a `LocalExplorer`, que lo usa para subir (botón y drop). El arrastre entre paneles usa los MIME `application/x-local-file(s)` y `application/x-s3-file(s)`.
- **Soltar desde el SO:** `S3Explorer.handleDrop` usa `file.path`, que no existe en Electron 39. Hoy esa vía falla en silencio.
- **Import:** `import-connections` solo comprueba que el JSON sea un array, y el renderer sustituye todas las conexiones por las importadas.

## Goals / Non-Goals

**Goals:**
- Un único tipo de conexión SSH que sirva a este change (SFTP) y al siguiente (terminal), con una sola conexión SSH reutilizable por servidor.
- Tocar `S3Explorer` lo mínimo, solo para el arreglo de soltar desde el SO.
- Ninguna migración destructiva de `connections.json`.

**Non-Goals:**
- Un explorador remoto genérico con proveedores enchufables. Podría venir después, cuando haya un tercer backend.
- Arreglar la marca `_encrypted` en sistemas sin cifrado disponible. Hay una tarea aparte (`harden-connection-store`) y aquí se mantiene el comportamiento actual.

## Decisions

### D1. Modelo de conexión como unión discriminada

```ts
interface EntryBase { id: string; name: string; parentId?: string | null; _encrypted?: boolean }
interface FolderEntry extends EntryBase { isFolder: true }
interface S3Connection extends EntryBase { type: 's3'; endpoint: string; accessKeyId: string; secretAccessKey: string; bucket?: string; region?: string }
interface SshConnection extends EntryBase {
  type: 'ssh'; host: string; port: number; username: string
  authMethod: 'password' | 'privateKey'; password?: string; privateKeyPath?: string; passphrase?: string
  initialPath?: string
}
type Connection = S3Connection | SshConnection
type ConnectionEntry = Connection | FolderEntry
```

Una función compartida `normalizeEntry(raw)` (en `src/shared/connections.ts`) trata como S3 toda entrada que no es carpeta y no tiene `type`. Rechaza tipos desconocidos o entradas sin los campos obligatorios. La usan `store.ts` al leer y el import.

*Alternativa descartada:* añadir campos opcionales a `S3Connection`. No da seguridad de tipos y mezcla campos de S3 y SSH en formularios y llamadas.

### D2. Cifrado por tipo

`store.ts` define los campos secretos por tipo: `s3 → accessKeyId, secretAccessKey` y `ssh → password, passphrase`. Solo cifra los presentes y no vacíos. `privateKeyPath` no es secreto: es una ruta, y la clave se lee del disco al conectar. La semántica de `_encrypted` no cambia (ver Non-Goals).

### D3. Librería: `ssh2` en el proceso principal

`ssh2` 1.17 (cliente SSH y subsistema SFTP) se usa solo en `src/main`. El renderer nunca abre sockets.

*Alternativas descartadas:*
- **`ssh2-sftp-client` o `node-ssh`:** son envoltorios sobre `ssh2` que ocultan el `Client`. El change de terminal necesita abrir canales `shell` sobre la misma conexión, y el progreso de `fastPut`/`fastGet` ya está en `ssh2`.
- **Invocar los binarios `ssh`/`sftp` del sistema:** no son portables (en Windows dependen de que esté instalado OpenSSH) y obligan a parsear su salida.

`ssh2` declara `cpu-features` y `nan` como dependencias opcionales para acelerar el cifrado de forma nativa. Si no compilan, usa la implementación JS.
- **macOS:** en la máquina de desarrollo compilan si hay Xcode CLT; si no, se usa JS.
- **Windows:** el CI (`windows-latest`) tiene herramientas de compilación. electron-builder desempaqueta los `.node` del asar automáticamente.
- **Linux:** igual que Windows en `ubuntu-latest`.

En los tres casos, el paquete debe funcionar con o sin el binario nativo (ver tareas de verificación).

### D4. Gestor de sesiones SSH (`src/main/ssh.ts`)

- **Pool:** una conexión por `connection.id` + huella de sus parámetros (host, puerto, usuario, método y ruta de la clave). Si el usuario edita la conexión, la huella cambia, se abre una conexión nueva y la vieja se cierra. Hay una sola instancia de SFTP por conexión, perezosa. Las entradas del pool se eliminan en `close`/`error`, y la siguiente operación reconecta.
- **Parámetros:** `readyTimeout: 15000`, `keepaliveInterval: 15000`.
- **Contraseña:** `password` + `tryKeyboard: true`, y se responde a `keyboard-interactive` con la contraseña en cada prompt.
- **Clave privada:** `fs.readFile` de la ruta con `~` expandido y `passphrase` si la hay. Formatos admitidos: OpenSSH, PEM y PuTTY PPK v2. Para una PPK v3 se muestra un error que sugiere convertirla con PuTTYgen.
  - **macOS/Linux:** el selector de clave abre por defecto `~/.ssh`.
  - **Windows:** abre por defecto `%USERPROFILE%\.ssh`.
- **Host key:** **no se verifica** (sin `hostVerifier`). Es decisión de producto; ver Riesgos.
- **Cierre:** el pool se cierra en `before-quit`.
- **Errores:** viajan como `Error` cuyo mensaje empieza por un código estable: `SSH_AUTH_FAILED` (`err.level === 'client-authentication'`), `SSH_UNREACHABLE` (`ENOTFOUND`/`ECONNREFUSED`/`EHOSTUNREACH`/`ENETUNREACH`), `SSH_TIMEOUT` (timeout del handshake), `SSH_KEY_UNREADABLE`, `SSH_KEY_UNSUPPORTED`, `SFTP_PERMISSION_DENIED` (código SFTP 3) y `SFTP_NOT_FOUND` (código SFTP 2). El renderer extrae el código y muestra el texto i18n, con el mensaje original como detalle.

El change `add-ssh-terminal` reutiliza este pool para abrir canales `shell`.

### D5. Operaciones SFTP y canales IPC

| Canal | Operación |
|---|---|
| `sftp-home` | `realpath('.')`, o `initialPath` si está configurado |
| `sftp-list-dir` | `readdir`: devuelve `{ currentPath, folders, files[{name, path, size, lastModified}] }`, el mismo formato que `local-list-dir`. Los enlaces simbólicos se resuelven con `stat` para saber si son carpeta. Se muestran los ficheros ocultos. |
| `sftp-create-dir` | `mkdir` |
| `sftp-delete` | Borrado recursivo en profundidad: `unlink` los ficheros y `rmdir` las carpetas. Los enlaces simbólicos se borran como enlace y nunca se sigue su destino. |
| `sftp-upload-file` / `sftp-download-file` | `fastPut`/`fastGet` con `step` → evento `transfer-progress {jobId, loaded, total}` |
| `show-open-file-dialog` | Selector de fichero para la clave privada |

Las rutas remotas son siempre POSIX (`path.posix`), independientemente del sistema local. Las rutas locales de destino las sigue calculando el renderer, como hoy.

### D6. Destino remoto genérico en el renderer

- `App.tsx` sustituye `s3Location` por `remoteLocation: { kind: 's3', bucket, prefix } | { kind: 'sftp', path } | null`. `LocalExplorer` lo usa para el botón de subir y para soltar archivos.
- `TransferJob.bucket` pasa a ser opcional. `processJob` ya obtiene la conexión: si `conn.type === 'ssh'` llama a `sftpUpload`/`sftpDownload` con rutas remotas absolutas en `destPath`/`sourcePath`, y si es S3, igual que ahora.
- El arrastre desde SFTP usa un MIME propio, `application/x-sftp-files` (`{ connectionId, paths }`). `LocalExplorer` acepta los de S3 y los de SFTP, y el payload de `S3Explorer` no cambia.

*Alternativa descartada:* un único MIME genérico para S3 y SFTP. Obligaría a reescribir el arrastre de `S3Explorer` sin ganar nada para el usuario.

### D7. Explorador SFTP como componente propio

`SftpExplorer.tsx` replica las interacciones de `S3Explorer`: navegación, selección múltiple, menú contextual (descargar, borrar), nueva carpeta, soltar para subir, arrastrar para descargar y recarga al terminar trabajos (`lastJobUpdate`). Reutiliza estilos y textos. Muestra la ruta actual y un botón "Reintentar" cuando hay un error de conexión.

### D8. Soltar desde el sistema operativo

El preload expone `getPathForFile: (file) => webUtils.getPathForFile(file)`. Lo usan `SftpExplorer` y `S3Explorer`, que hoy usa `file.path`. `webUtils` está disponible en Electron ≥ 29 en los tres sistemas.

### D9. Formulario de conexión

El selector de tipo (S3 | SSH) solo aparece al crear; al editar, el tipo es fijo. Los campos SSH son: host, puerto (22), usuario, método (contraseña / clave privada), contraseña, o bien ruta de la clave con botón "Examinar…" y passphrase opcional, y directorio inicial. La lista de conexiones muestra un icono por tipo: S3 conserva el actual (lucide `HardDrive`) y SSH usa `Server`.

### D10. Validación del import

`import-connections` aplica `normalizeEntry` a cada entrada. Si alguna falla, lanza error y el renderer muestra `settings.importError` sin guardar nada. Las entradas sin tipo se importan como S3.

## Risks / Trade-offs

- **[Host key sin verificar → man-in-the-middle]** Un atacante en la red puede suplantar al servidor y capturar la contraseña o los datos transferidos. → Decisión explícita del propietario para esta versión. Queda documentado en proposal y README, y la verificación (TOFU + known_hosts) es candidata a un change futuro. El riesgo es menor con clave privada: el atacante no obtiene la clave, aunque sí puede ver la sesión.
- **[Dependencias nativas opcionales de `ssh2` rompen `npm ci` o el empaquetado en algún SO]** → Verificación en las tres plataformas (tareas 6.x). Si dieran problemas, plan B: excluirlas del empaquetado (`files: '!node_modules/cpu-features/**'`), ya que `ssh2` funciona sin ellas.
- **[Secretos SSH descifrados en el renderer]** El formulario de edición los necesita y es el mismo patrón que S3. → Se acepta por coherencia. No se escriben en logs.
- **[Directorios muy grandes]** Un `readdir` con miles de entradas tarda y renderiza todo. → Se acepta en esta versión, igual que en S3.
- **[Conexión caída a mitad de operación]** → El pool descarta la conexión en `close`/`error`, la operación falla con el código correspondiente y la siguiente reconecta. La cola marca el trabajo en error y se puede reintentar.
- **[Versiones anteriores leyendo datos nuevos]** Una v0.0.x mostraría las conexiones SSH como S3 rotas. → Es aceptable porque no se pierde nada: al volver a la versión nueva siguen ahí.

## Migration Plan

1. Sin migración explícita: `normalizeEntry` añade `type: 's3'` en memoria y se persiste en el siguiente guardado.
2. Publicar junto al change de terminal y el renombrado (v0.1.0) o por separado. Ninguno depende de la versión del otro para los datos.
3. **Rollback:** revertir el change. Las conexiones S3 siguen funcionando (el campo `type` extra se ignora) y las SSH quedan inertes.
