# Absor Connect — guía para agentes

Lee primero el `README.md` (qué es, stack, comandos). Aquí va lo que no se deduce del código.

## Idioma y estilo
- Interfaz, comentarios y documentación **en español**; identificadores de código y mensajes de commit en inglés (Conventional Commits: `feat:`, `fix:`, `docs:`…). Los textos de la app van por i18n (`src/renderer/src/locales/es.json` y `en.json`).
- Cambios con **OpenSpec** (`openspec/`): propuesta en `openspec/changes/<nombre>`, implementación con `/opsx:apply`, archivo con `/opsx:archive`. Las specs vigentes están en `openspec/specs/`.
- Backend al estilo de Politinder: `final class`, propiedades promovidas `readonly`, atributos (`#[Route]`, `#[Autowire]`), cuerpo JSON leído con `JsonBody::from()` y errores como `ApiException(code, status, details)` con códigos `snake_case` estables y cuerpo `{"error": {"code", "details"}}`.

## Estructura
- `src/`: app Electron (`main`, `preload`, `renderer`, `shared`).
- `mobile/`: apps de Android e iPhone (Flutter). Desarrollo, pruebas y firma en `mobile/README.md`.
- `backend/`: API Symfony de cuentas y conexiones en la nube. Su desarrollo y despliegue: `compose*.yaml`, `docker/`, `kube/` y `Jenkinsfile` (ver `docker/AGENTS.md` y `kube/AGENTS.md`).
- Nada del backend, de `mobile/` ni de `openspec/` entra en el paquete de Electron: lo excluye `electron-builder.yml`. Si se añade algo en la raíz que no sea de la app, hay que excluirlo ahí también.

## Decisiones que conviene no romper

### App
- **Conexiones en la cuenta, no en el disco** (`src/main/cloud/`): el proceso principal guarda la lista en la API y la tiene en caché; el token nunca llega al renderer. Lecturas y escrituras van en fila (`cloudStore.ts`) para que dos guardados seguidos no choquen entre sí con un 409.
- **`connections.json` solo se lee para migrarlo** (`store.ts` + `cloud/migration.ts`): aparta el fichero dañado a `connections.json.corrupt-<fecha>`, sube los secretos que no puede descifrar vacíos y con `credentialsUnavailable`, y borra el fichero y su `.bak` solo si la subida va bien.
- **Errores de la API en el renderer**: las operaciones de cuenta devuelven `{ok: false, code}` y las de conexiones lanzan un error cuyo mensaje acaba en el código (`cloudErrors.ts`). Toda llamada que pueda fallar se captura: `main.tsx` convierte cualquier promesa rechazada sin capturar en un `alert()`.
- **`safeStorage` solo con sesión**: en macOS cada acceso puede abrir el diálogo del Llavero. Sin `session.json` la app arranca sin tocarlo; se usa para el token de sesión (`src/main/cloud/session.ts`) y, una vez, para leer `connections.json` en la migración.
- **Windows**: el instalador se construye con NSIS 3.12 (`toolsets.nsis: '1.2.1'` en `electron-builder.yml`); el 3.0.4.1 por defecto se cuelga en parte de las instalaciones.
- **Paquetes `.deb`**: se construyen en Linux; el `ar` de macOS genera paquetes rotos.
- **macOS sin certificado de Apple**: `identity: '-'` en `electron-builder.yml` firma el paquete ad-hoc. Sin ella macOS dice que la app «está dañada» (firma rota) en vez de ofrecer «Abrir igualmente». Con firma ad-hoc, `hardenedRuntime` sigue en `false`, y las actualizaciones automáticas no pueden instalarse solas en Mac (Squirrel exige el mismo certificado).

### Apps móviles
- **Misma lista de conexiones que el escritorio**: la app conserva los campos que no conoce al editar una entrada, y cualquier cambio de campos de una conexión hay que hacerlo en el escritorio, el backend (`EntryValidator`) y `mobile/lib/ui/connection_form.dart` a la vez.
- **Claves privadas por dispositivo** (`mobile/lib/src/keys.dart`): en la cuenta solo va `privateKeyPath` (el nombre del fichero); el contenido se importa en cada móvil y nunca se sube.
- **Clave de firma de Android única**: si cambia, Android no instala la versión nueva encima de la anterior. Vive en los secrets `ANDROID_KEYSTORE_*` y el propietario guarda una copia; no generar otra.
- **iOS sin firmar**: no hay cuenta de Apple Developer. La IPA la firma SideStore/AltStore Classic/Sideloadly en cada iPhone, así que nada que necesite capabilities de pago (push, iCloud, App Groups). AltStore PAL no sirve (exige apps notarizadas con `marketplaceID`). La fuente debe declarar los mismos `UsageDescription` que el `Info.plist`, o AltStore no instala la app.
- **El `versionCode` lo pone CI** (`github.run_number`): una release compilada en local con un número menor no se instalaría encima.

### Backend
- **Tokens opacos por dispositivo** (`acs_…`, `SessionManager`): en BD solo su SHA-256. La caducidad (90 días) se desliza y se escribe como mucho una vez por hora. La app trata cualquier 401 como sesión caducada, por eso `password_incorrect` es un 403.
- **`PUT /api/connections` reemplaza la lista entera** con control de revisión y la fila de la cuenta bloqueada (`SELECT … FOR UPDATE`). `ConnectionStore::replace()` no usa `wrapInTransaction()`: cierra el EntityManager al fallar, y tras un conflicto hay que leer la lista actual para el 409.
- **Secretos cifrados con `CONNECTIONS_KEY`** (`ConnectionsCrypto`, sodium), nunca con `APP_SECRET`. Una entrada con `credentialsUnavailable` y sin secretos nuevos conserva el valor cifrado guardado; un secreto sin cambios no se vuelve a cifrar.
- **La validación es un port de `normalizeEntry`** (`src/shared/connections.ts` → `EntryValidator`). Si cambian los campos o los secretos de una conexión en la app, hay que cambiar también `EntryValidator` y `EntryKind::secretFields()` (los mismos que `SECRET_FIELDS`).
- **Límites de intentos en Postgres** (`cache_items`, pool `app.rate_limiter_cache`): son uno para todas las réplicas. No aceptar un `migrations:diff` que borre esa tabla.
- **Fechas en UTC sin zona horaria**: en SQL escrito a mano se pasa la hora desde PHP, no `NOW()` (el Postgres compartido puede tener otra zona).
- **Puertos de desarrollo**: 8020 (API) y 5434 (Postgres), distintos de AbsorQuiz y Politinder. Caddy escucha en `:80` con cualquier nombre de host (`SERVER_NAME`), porque el emulador de Android llega a la API como `10.0.2.2`.

## Verificación mínima antes de dar algo por hecho
```bash
npm run typecheck
docker compose exec php php bin/phpunit
# Si se toca mobile/ (con el entorno de mobile/tool/test_env.sh)
(cd mobile && flutter analyze && flutter test)
```
