# Design

## Context

Ver proposal.md (Why). En `src/main/store.ts`, `getConnections()` lee `connections.json`, normaliza las entradas y descifra los secretos de cada una. Si se marcó `_encrypted: true`, el descifrado ocurre dentro de un único `try/catch` para todo el fichero: cualquier fallo (JSON inválido, `safeStorage.decryptString` que lanza) devuelve `[]`. El renderer guarda la lista completa con `saveConnections()` en cada cambio de la barra lateral, así que una lista vacía acaba sobrescribiendo el fichero. Además, `encryptField` devuelve el valor en claro cuando `safeStorage.isEncryptionAvailable()` es falso, pero la entrada se marca igualmente con `_encrypted: true`.

`safeStorage` produce blobs de OSCrypt que empiezan por `v10` o `v11` (en base64, `djEw` / `djEx`) en macOS (Llavero), Windows (DPAPI) y Linux (libsecret/kwallet).

## Goals / Non-Goals

**Goals:**
- Ninguna ruta de lectura fallida puede acabar en un guardado que borre datos.
- Decidir por campo si un secreto está cifrado, sin fiarse de `_encrypted`.
- Mantener el formato del fichero (compatible con v0.0.7 y v0.1.0).

**Non-Goals:**
- Recuperar secretos sin la clave original.
- Bloquear la app cuando hay problemas: se avisa y se sigue funcionando con lo que se pueda leer.

## Decisions

### D1. Detección de secreto cifrado por campo
`isEncryptedBlob(value)` comprueba que el valor es base64 válido y que, decodificado, empieza por `v10` o `v11`.
- **Blob:** se intenta descifrar. Si falla, el secreto queda **ilegible**.
- **No blob:** se trata como texto en claro, aunque la entrada diga `_encrypted: true` (el caso de Linux sin keyring en v0.0.x).

`_encrypted` pasa a ser informativo al leer.

*Alternativa descartada:* confiar en `_encrypted` y migrar el fichero. No resuelve los ficheros ya escritos con la marca falsa.

### D2. Credenciales ilegibles: marca en tiempo de ejecución y conservación al guardar
- **Al leer**, una conexión con algún secreto ilegible se devuelve con ese secreto vacío y `credentialsUnavailable: true`. La marca no se persiste.
- **Al guardar**, `saveConnections` relee el fichero en crudo y, para cada entrada entrante con `credentialsUnavailable`, conserva **tal cual** el valor guardado de cada secreto que llega vacío. Los que llegan con valor se cifran como siempre.
- **El formulario de edición** de una conexión marcada avisa de que hay que volver a introducir las credenciales y no obliga a rellenarlas. Si el usuario no las rellena, la marca se mantiene en el borrador y el secreto original se conserva.

### D3. `_encrypted` veraz y secretos en claro heredados
- Al guardar, cada secreto no vacío se cifra si `safeStorage.isEncryptionAvailable()`.
- `_encrypted: true` solo se escribe si todos los secretos no vacíos de la entrada quedan como blobs.
- Un secreto heredado en claro se cifra en el siguiente guardado si ya hay almacén seguro.

Por sistema:
- **macOS y Windows:** el almacén seguro (Llavero o DPAPI) siempre está disponible, así que todo queda cifrado.
- **Linux:** depende de que haya libsecret o kwallet. Sin ellos, se guarda en claro sin la marca y Ajustes lo indica.

### D4. Fichero dañado o ilegible
- **JSON inválido o raíz que no es un array:** se renombra a `connections.json.corrupt-<fecha ISO con '-'>`, se registra la ruta en el estado del almacén y se devuelve `[]`. El siguiente guardado crea un fichero nuevo sin tocar la copia.
- **Error de E/S distinto de `ENOENT`** (permisos, por ejemplo): se devuelve `[]`, se marca `readFailed` y `saveConnections` **rechaza** guardar con un error. No se puede garantizar que no se pierda nada si no se leyó el fichero.

### D5. Escritura atómica con copia previa
`saveConnections` escribe en `connections.json.tmp`, copia el fichero actual a `connections.json.bak` (si existe) y renombra el temporal sobre `connections.json`. `fs.rename` reemplaza el destino en los tres sistemas; en Windows Node usa `MoveFileEx` con reemplazo.

### D6. Estado del almacén y avisos
Nuevo canal `get-store-status`, que devuelve `{ unreadableCredentials, recoveredFile }` de la última lectura. **No consulta `safeStorage`**: en macOS eso accede al Llavero, y con builds sin firma abre un diálogo que bloquea el proceso principal; el estado se pide en cada arranque. La disponibilidad de cifrado va por otro canal, `is-encryption-available`, que solo usa Ajustes. Devuelve `true` en macOS y Windows (Llavero y DPAPI siempre existen) y consulta `safeStorage` solo en Linux. Al guardar, `safeStorage` solo se consulta si hay algún secreto que cifrar.
- **Barra lateral:** aviso cuando hay credenciales ilegibles o un fichero apartado, y un icono `AlertTriangle` en cada conexión marcada.
- **Ajustes:** nota en la sección Conexiones cuando `encryptionAvailable` es falso.

## Risks / Trade-offs

- **[Un secreto en claro que parezca un blob]** Una contraseña que empiece por `djEw` y sea base64 válido se trataría como cifrada y saldría como ilegible. → Probabilidad despreciable. El usuario la volvería a introducir sin perder nada.
- **[Copia `.bak` con secretos]** Contiene lo mismo que el fichero principal, con el mismo cifrado. → Mismo nivel de protección que `connections.json`.
- **[Lectura doble al guardar]** `saveConnections` relee el fichero. → Coste despreciable para el tamaño de este fichero.
