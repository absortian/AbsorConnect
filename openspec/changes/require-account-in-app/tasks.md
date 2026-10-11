# Tasks

## 1. Main

- [ ] 1.1 `src/main/cloud/apiClient.ts`: `fetch` con timeout, URL base (`MAIN_VITE_API_URL` o `ABSOR_CONNECT_API_URL`), traducción de errores y gestión del 401 (D1). Verificar: `npm run typecheck:node` y prueba contra el backend de desarrollo (login correcto, credenciales incorrectas y servicio caído → `network_error`).
- [ ] 1.2 `session.ts`: guardar y leer `session.json` con `safeStorage` (D2), y login, registro y logout contra la API. Verificar: tras iniciar sesión, `session.json` no contiene el token en claro (macOS) y reiniciar la app conserva la sesión.
- [ ] 1.3 `cloudStore.ts`: caché, `GET`/`PUT` con revisión, conflicto 409 → `connections-changed` y refresco al recuperar el foco (D3). Los canales `get-connections` y `save-connections` pasan a usar el almacén en la nube. Verificar: guardar desde dos instancias con cuentas iguales produce el aviso de conflicto en la segunda.
- [ ] 1.4 Migración (D5): detección tras el login, fusión por `id`, `PUT` y borrado de `connections.json` y `.bak` solo tras éxito. Canales `get-migration-offer` y `migrate-local-connections`. Verificar: los escenarios de "Migración de las conexiones locales" (subir, aplazar, fallo al subir, fichero dañado y secretos en claro o ilegibles).
- [ ] 1.5 Canales de sesión y cuenta: `get-session`, `login`, `register`, `logout`, `change-password`, `delete-account`, y eventos `session-expired` y `connections-changed`. Cerrar sesión cierra el pool SSH. Verificar: `npm run typecheck`.

## 2. Preload

- [ ] 2.1 Exponer la API de sesión, cuenta, migración y eventos, con tipos en `index.d.ts`. Verificar: `npm run typecheck`.

## 3. Renderer

- [ ] 3.1 `AuthScreen.tsx` (iniciar sesión y crear cuenta, errores por código) y puerta de sesión en `App.tsx` con la pantalla "servicio no disponible" y "Reintentar" (D4). Verificar con el arnés: primer arranque → pantalla de acceso; registro → entra; servicio caído → error y reintento.
- [ ] 3.2 Diálogo de migración propio de la app (D5). Verificar con el arnés: aparece con el número de conexiones locales; "Subir" y "Ahora no" se comportan según la spec.
- [ ] 3.3 La barra lateral escucha `connections-changed` (recarga y aviso de conflicto), y `session-expired` devuelve a la pantalla de acceso tras cerrar terminales y vaciar la cola. Verificar con el arnés: los escenarios de "Cambios desde otros equipos" y "Sesión revocada desde otro lugar".
- [ ] 3.4 Ajustes > Cuenta: email, cambiar contraseña, cerrar sesión y borrar cuenta con confirmación de la app (D6). La nota de Linux pasa a hablar de la sesión. Verificar con el arnés: los escenarios de "Gestión de la cuenta" y "Cerrar sesión".
- [ ] 3.5 Textos en `locales/en.json` y `es.json` (acceso, errores de la API, migración, cuenta, conflicto, servicio no disponible). Verificar: sin claves i18n sin traducir.

## 4. Configuración y documentación

- [ ] 4.1 `MAIN_VITE_API_URL` en `.env.production` y `.env.development` de electron-vite, y opción de sobrescribirla en `release.yml` (D8). Verificar: un build de producción incrusta la URL configurada.
- [ ] 4.2 README: cuentas, migración, URL de la API y cómo desarrollar contra el backend local. Verificar: lectura del README renderizado.

## 5. Verificación

- [ ] 5.1 `npm run typecheck` pasa y los ficheros nuevos o tocados no añaden errores de lint.
- [ ] 5.2 (arnés + backend de desarrollo en Docker) Recorrer los escenarios de `app-session` y `connection-management` de este change, incluido "Contraseña SSH guardada": no se crea `connections.json` tras guardar.
- [ ] 5.3 Regresión: el explorador SFTP, la terminal y la cola de transferencias funcionan con las conexiones de la nube (contra el servidor SSH de pruebas).
- [ ] 5.4 Paquete de macOS: con la URL configurada, la app empaquetada arranca en la pantalla de acceso y sin diálogos del Llavero antes de iniciar sesión.

## Workflow follow-up

- Publicar la versión cuando el backend esté desplegado y el dominio creado.
- Archivar el change tras verificarlo.
