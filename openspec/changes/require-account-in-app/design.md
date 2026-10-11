# Design

## Context

Ver proposal.md (Why). La API y su contrato están en `add-cloud-backend` (D4: rutas, códigos de error y formato de entradas).

Hoy el renderer usa `window.api.getConnections()` / `saveConnections(list)` desde la barra lateral, la cola de transferencias, la terminal y Ajustes (import/export). El proceso principal resuelve esas llamadas con `store.ts` sobre `connections.json`, con las garantías de `harden-connection-store`.

## Goals / Non-Goals

**Goals:**
- Mantener la API IPC `getConnections`/`saveConnections` para que los componentes del renderer apenas cambien: solo cambia quién la resuelve.
- El token nunca sale del proceso principal: el renderer no lo ve ni lo envía.

**Non-Goals:**
- Caché persistente de conexiones para trabajar sin conexión.

## Decisions

### D1. Cliente de la API en el proceso principal (`src/main/cloud/`)
- `apiClient.ts` usa el `fetch` de Node, con timeout de 15 s.
- La URL base se lee de `import.meta.env.MAIN_VITE_API_URL` (electron-vite la incrusta al compilar). En desarrollo se puede sobrescribir con la variable de entorno `ABSOR_CONNECT_API_URL`.
- Los errores se traducen al formato del renderer con un código estable: los de la API (`invalid_credentials`, `email_taken`…) más `network_error`.
- **Un 401 en cualquier llamada autenticada** borra la sesión local y emite `session-expired` al renderer.

*Alternativa descartada:* llamar a la API desde el renderer. Expondría el token a la página y obligaría a configurar CORS.

### D2. Sesión en el equipo
`session.json` en `userData` guarda `{token, email}` con el token cifrado con `safeStorage`.
- **macOS:** el token va al Llavero mediante `safeStorage`. Con builds sin firma, macOS puede pedir permiso tras una actualización, como ya pasaba con las credenciales.
- **Windows:** DPAPI, sin avisos.
- **Linux:** se cifra con libsecret o kwallet si existen. Si no, se guarda en claro y Ajustes muestra la nota de almacén no disponible (reutiliza `is-encryption-available`).

El nombre del dispositivo que se envía al iniciar sesión es `os.hostname()`.

### D3. Almacén de conexiones en la nube (`cloudStore.ts`)
- **Caché en memoria** `{revision, entries}` con la última lista recibida.
- **`getConnections()`:** devuelve la caché. Si no hay, llama a `GET /api/connections`.
- **`saveConnections(list)`:**
  1. Hace `PUT` con la revisión de la caché.
  2. Si va bien, actualiza la caché con la respuesta del servidor (que ya trae las marcas `credentialsUnavailable`).
  3. Si hay un 409, actualiza la caché con la lista del 409, emite `connections-changed` con `{conflict: true}` y lanza un error de conflicto.
- **Refresco:** al recuperar el foco la ventana, si han pasado más de 30 s desde la última lectura, se hace `GET`. Si la revisión cambió, se emite `connections-changed`.
- **Renderer:** la barra lateral escucha `connections-changed` para recargar su lista. Con `conflict` muestra un aviso, y si hay un modal abierto se mantiene.
- **Consumidores sin cambios:** la cola de transferencias, la terminal y el explorador siguen llamando a `getConnections()`, que ahora sale de memoria y no hace una petición por operación.

### D4. Puerta de sesión en el renderer
`App.tsx` pide `window.api.getSession()` al arrancar:
- `{state: 'signed-out'}` → muestra `AuthScreen`.
- `{state: 'signed-in', email}` → precarga las conexiones y muestra la interfaz actual.
- `{state: 'unreachable'}` → pantalla de error con "Reintentar".

**`AuthScreen`:**
- Pestañas "Iniciar sesión" / "Crear cuenta", con email, contraseña y confirmación de la contraseña al crear cuenta.
- Mensajes por código de error, con i18n.
- Mismo estilo glass que el resto de la app.

El evento `session-expired` y el cierre de sesión devuelven a `AuthScreen`. Antes se cierran las terminales y el pool SSH (`closeAllSsh`) y se vacía la cola de transferencias.

### D5. Migración de `connections.json`
Tras un login o registro correcto, el proceso principal lee el fichero con el `store.ts` actual, que normaliza, descifra y aparta el fichero si está dañado, con las garantías de `harden-connection-store`.
- **Sin entradas legibles:** no se pregunta nada.
- **Con entradas:** el renderer muestra un diálogo de la app (no `window.confirm`) con el número de conexiones y dos botones, "Subir a mi cuenta" y "Ahora no".

Al subir:
1. Fusión: entradas de la nube y, a continuación, las locales cuyo `id` no esté ya en la nube, conservando sus carpetas.
2. `PUT` con la revisión actual.
3. Solo si el `PUT` va bien, se borran `connections.json` y `connections.json.bak`.
4. Las entradas locales con credenciales ilegibles se suben con los secretos vacíos y sin la marca. En la nube no hay un secreto antiguo que conservar, así que la conexión queda sin credenciales y la persona las reintroduce al editarla.

"Ahora no" no toca nada, y el diálogo vuelve a salir en el siguiente inicio de sesión.

### D6. Ajustes > Cuenta
Nueva sección arriba de Ajustes:
- Email de la cuenta.
- "Cambiar contraseña" (actual + nueva + confirmación → `PUT /api/me/password`).
- "Cerrar sesión".
- "Borrar cuenta": confirmación de la app con aviso de que se borran todas las conexiones, contraseña → `DELETE /api/me`, y vuelta a `AuthScreen`.

La nota de Linux sobre el almacén no disponible pasa a decir que la **sesión** se guarda sin cifrar.

### D7. Import / export
- **Exportar** escribe la lista de la caché, igual que antes y con el mismo aviso.
- **Importar** valida con `normalizeEntry` y reemplaza la lista de la cuenta con un `PUT`, igual que antes reemplazaba la local.

### D8. Configuración de compilación
- `MAIN_VITE_API_URL` en `.env.production` (electron-vite), con el dominio que cree el propietario. Mientras no exista, un valor provisional documentado.
- En `release.yml` se puede sobrescribir con una variable del repositorio.
- En desarrollo: `http://localhost:8020` (compose del backend).

## Risks / Trade-offs

- **[Sin modo sin conexión]** Sin internet no hay conexiones. → Decisión de producto (cuenta obligatoria y todo en la nube). La pantalla de error lo explica y permite reintentar.
- **[Conflicto: se pierde el último cambio local]** → Aviso explícito para que la persona lo repita. Con una sola persona por cuenta es raro.
- **[Rutas de clave privada entre equipos]** La ruta guardada puede no existir en otro equipo. → El error `SSH_KEY_UNREADABLE` ya lo explica. Sincronizar claves queda fuera de alcance.
- **[Token en claro en Linux sin keyring]** Igual que antes las credenciales, ahora solo el token. → Nota en Ajustes, y el token se puede revocar cerrando sesión desde otro equipo… (no hay lista de sesiones en esta versión; cambiar la contraseña las revoca todas).

## Migration Plan

1. Requiere `add-cloud-backend` desplegado y el dominio de la API creado.
2. Publicar una versión de la app con `MAIN_VITE_API_URL` apuntando al dominio. A partir de ahí, cada usuario migra al iniciar sesión.
3. **Rollback:** publicar la versión anterior. Quien no haya migrado conserva su `connections.json`. Quien sí lo hizo tendría que exportar desde una versión con cuenta e importar en la anterior.
