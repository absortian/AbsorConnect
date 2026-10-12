# Proposal

## Why

Con el backend de `add-cloud-backend`, las conexiones pueden vivir en la nube asociadas a una cuenta. La app tiene que empezar a usarlo: exigir una cuenta, guardar y leer las conexiones del servicio en vez de `connections.json`, y llevar a la nube las conexiones que cada usuario ya tenía en su equipo. Así un usuario ve sus conexiones en todos sus equipos y no las pierde con el equipo.

## What Changes

- **Cuenta obligatoria:** sin sesión, la app muestra una pantalla de acceso (iniciar sesión o crear cuenta) en lugar de la interfaz.
- **Sesión recordada por dispositivo:** el token se guarda cifrado con el almacén seguro del sistema. Al caducar o revocarse, se vuelve a la pantalla de acceso.
- **Conexiones en la nube:** el proceso principal lee y guarda la lista en la API (`GET`/`PUT /api/connections` con revisión). Si otro dispositivo guardó antes, se recarga la lista y se avisa. La lista se refresca al volver a la ventana.
- **Migración de las conexiones locales:** tras el primer inicio de sesión en un equipo con `connections.json`, la app pregunta si subirlas. Si se aceptan, se añaden a la cuenta y se **borran del disco**. Si no, se vuelve a preguntar en el siguiente inicio.
- **Ajustes > Cuenta:** email, cerrar sesión, cambiar contraseña y borrar la cuenta.
- **Servicio no disponible:** pantalla de error con "Reintentar". No hay modo sin conexión.
- **URL de la API** configurable en compilación (y por variable de entorno en desarrollo).
- **Exportar e importar** siguen funcionando, ahora contra la nube.

## Fuera de alcance

- Modo local sin cuenta y caché sin conexión de las conexiones.
- Verificación de email y recuperación de contraseña por correo (lo hace el operador, ver `add-cloud-backend`).
- Sincronizar ajustes de la app (tema, idioma): siguen siendo locales a cada equipo.
- Sincronizar el contenido de las claves privadas: solo viaja su ruta, que puede no existir en otro equipo.

## Impacto en usuarios existentes

- **Datos:** al actualizar, deben crear una cuenta o iniciar sesión, y se les ofrece subir sus conexiones locales. Hasta que acepten, `connections.json` sigue intacto en su equipo. Al aceptar y subirse bien, se borra (también la copia `.bak`).
- **Credenciales:** pasan del almacén seguro del equipo al servicio, cifradas en reposo con la clave del servicio (ver `add-cloud-backend` y sus riesgos). Las que no se podían leer en el equipo se suben sin secreto y quedan pendientes de reintroducir.
- **Auto-update:** ninguno. El token de sesión vive en `userData`, que no cambia.
- **macOS sin firma:** el token usa el Llavero, igual que antes las credenciales, así que el aviso tras una actualización sigue existiendo.

## Capabilities

### New Capabilities
- `app-session`: acceso obligatorio, inicio de sesión y registro en la app, sesión recordada, cierre y caducidad de sesión, gestión de la cuenta y comportamiento sin servicio.

### Modified Capabilities
- `connection-management`:
  - Las conexiones se guardan en la nube y no en el disco.
  - Se elimina la protección local de secretos, el tratamiento del fichero local dañado y la lectura de secretos heredados en claro como requisitos permanentes.
  - Se añade la migración de las conexiones locales, que es donde pasan a aplicarse esos dos últimos.
  - La compatibilidad con versiones anteriores y la conservación de credenciales ilegibles se adaptan.

## Impact

- **Main:**
  - Nuevo `src/main/cloud/` (cliente de la API, sesión y almacén en la nube).
  - `store.ts` pasa a usarse solo para leer `connections.json` en la migración.
  - `index.ts` (canales de sesión, cuenta y migración, y refresco).
- **Preload y tipos:** API de sesión y cuenta.
- **Renderer:**
  - Nueva pantalla de acceso.
  - `App.tsx` (puerta de sesión y avisos de cambios remotos).
  - Diálogo de migración.
  - `SettingsPanel.tsx` (sección Cuenta).
  - Locales en y es.
- **Configuración:** `MAIN_VITE_API_URL` en `.env` de electron-vite y en `release.yml`.
- **Depende de:** `add-cloud-backend` desplegado y del dominio de la API (lo crea el propietario en Cloudflare).
