# Absor Connect

*(antes Absor S3 Explorer)*

**Descarga e instrucciones de instalación: [absorconnect.absor.top](https://absorconnect.absor.top)** · gratis para macOS, Windows, Linux, Android e iPhone.

Aplicación de escritorio para gestionar archivos entre el sistema de archivos local y servicios remotos (almacenamiento compatible con S3, como AWS S3, MinIO o DigitalOcean Spaces, y servidores SSH mediante SFTP) desde una interfaz unificada de doble panel.

> **Nota:** Este proyecto es un experimento de *vibe coding*. Fue desarrollado íntegramente utilizando VS Code con GitHub Copilot, sin instrucciones precisas preconfiguradas, con el objetivo de explorar cómo responde el editor y su agente de IA ante peticiones abiertas y progresivas. El resultado es esta aplicación funcional construida de forma conversacional.

## Características

- **Explorador dual** — Panel izquierdo para el sistema de archivos local y panel derecho para el servicio remoto (buckets S3 o directorios SFTP), permitiendo navegar ambos simultáneamente.
- **Cuenta en la nube** — Registro con email y contraseña. Las conexiones se guardan en tu cuenta y las ves en todos tus equipos; la sesión de cada equipo se recuerda entre reinicios.
- **Gestión de conexiones** — Crear, organizar en carpetas y guardar conexiones S3 y SSH en tu cuenta. Las credenciales (claves de acceso, contraseñas y passphrases) se guardan cifradas en el servicio; los cambios hechos desde otro equipo aparecen al volver a la ventana.
- **Conexiones SSH / SFTP** — Autenticación por contraseña o por clave privada (ruta al fichero, con passphrase opcional; la clave no se copia a la app) y directorio inicial opcional.
- **Terminal SSH** — Terminales interactivas en pestañas junto al explorador, sobre la misma conexión SSH (sin volver a autenticarse). Varias a la vez, del mismo o de distintos servidores, con colores, UTF-8, programas a pantalla completa, redimensionado automático y reconexión. Copiar y pegar: **Cmd+C / Cmd+V** en macOS y **Ctrl+Shift+C / Ctrl+Shift+V** en Windows y Linux (Ctrl+C envía la interrupción al servidor).
- **Transferencias drag-and-drop** — Arrastrar archivos entre paneles para subir o descargar. También disponible mediante menú contextual.
- **Cola de transferencias** — Barra inferior que muestra el estado en tiempo real de cada transferencia (pendiente, subiendo, descargando, completado, error).
- **Operaciones remotas** — Crear carpetas, eliminar objetos o archivos (en SFTP, las carpetas se borran con todo su contenido) y descargar archivos individuales.
- **Interfaz moderna** — Tema oscuro con elementos glassmorphism, sidebar colapsable e indicadores de estado en tiempo real.

## Stack tecnológico

| Categoría | Tecnología |
|---|---|
| Framework de escritorio | Electron |
| UI | React + TypeScript |
| Build | Vite (electron-vite) |
| AWS SDK | @aws-sdk/client-s3 |
| SSH / SFTP | ssh2 |
| Terminal | xterm.js (@xterm/xterm) |
| Persistencia | API de cuentas (conexiones) y ficheros JSON locales (sesión y ajustes) |
| Iconos | lucide-react |
| Empaquetado | electron-builder |
| Backend (cuentas en la nube) | Symfony 8.1 · PHP 8.5 · PostgreSQL 16 · FrankenPHP |
| Apps móviles (`mobile/`) | Flutter · dartssh2 · xterm · cliente S3 propio |

## Desarrollo

```bash
# Instalar dependencias
npm install

# Ejecutar en modo desarrollo
npm run dev

# Compilar para producción
npm run build
```

La app necesita el backend: `npm run dev` usa el de desarrollo en `http://localhost:8020` (`docker compose up -d --wait`, ver más abajo) y los builds de producción usan `https://absorconnect.absor.top`. La URL se incrusta al compilar desde `MAIN_VITE_API_URL` (`.env.development` y `.env.production`; en `release.yml` la sustituye la variable del repositorio del mismo nombre). Para apuntar cualquier build a otro backend sin recompilar: `ABSOR_CONNECT_API_URL=http://localhost:8020` al arrancar la app.

## Apps para Android e iPhone

`mobile/` es la app de Flutter con la misma cuenta y las mismas conexiones: explorador SFTP y S3 y terminal SSH. No está en las tiendas (no hay cuentas de desarrollador): en Android se instala el APK firmado de la release y en iPhone la IPA sin firmar con AltStore, SideStore o Sideloadly. Cada release adjunta el APK, la IPA y `altstore-source.json` (la fuente de AltStore/SideStore). Desarrollo, pruebas y firma: [`mobile/README.md`](mobile/README.md).

## Backend (cuentas y conexiones en la nube)

`backend/` es la API con la que la app guarda las conexiones en una cuenta (registro con email y contraseña). En producción vive en `https://absorconnect.absor.top`. Las credenciales de las conexiones se guardan cifradas con una clave del servicio (`CONNECTIONS_KEY`), y de los tokens de sesión solo se guarda su hash.

### Desarrollo

Requisito único: **Docker** (no hace falta PHP en local).

```bash
# API en http://localhost:8020 y PostgreSQL en localhost:5434 (datos en ./.docker/)
docker compose up -d --wait

# Primera vez: esquema de la base de datos
docker compose exec php php bin/console doctrine:migrations:migrate -n

# Tests (la primera vez crean la base de datos app_test; cada test se deshace al acabar)
docker compose exec php sh -c "php bin/console --env=test doctrine:database:create --if-not-exists -n && php bin/console --env=test doctrine:migrations:migrate -n && php bin/phpunit"
```

Para resetear la base de datos: `docker compose down && rm -rf .docker/postgres`.

### API

| Método y ruta | Uso |
|---|---|
| `POST /api/auth/register` · `POST /api/auth/login` | `{email, password, deviceName}` → `{token, user}` |
| `POST /api/auth/logout` | Cierra la sesión de este dispositivo |
| `GET /api/me` · `PUT /api/me/password` · `DELETE /api/me` | Cuenta: datos, cambio de contraseña (cierra las demás sesiones) y borrado |
| `GET /api/connections` · `PUT /api/connections` | Lista `{revision, entries}`; el `PUT` la reemplaza entera y responde 409 si otra sesión guardó antes |
| `GET /api/health` | Comprobación de PHP y PostgreSQL |

Las rutas autenticadas llevan `Authorization: Bearer <token>`. Los errores son `{"error": {"code": "…"}}` con códigos estables (`email_taken`, `invalid_credentials`, `connections_conflict`…). El contrato completo está en `openspec/changes/add-cloud-backend/design.md` (D4).

### Comandos de operación

```bash
# No hay recuperación por correo: el operador genera una contraseña nueva (cierra todas las sesiones)
docker compose exec php php bin/console app:user:reset-password persona@correo.com

# Cuentas con su número de conexiones y de sesiones activas (sin secretos)
docker compose exec php php bin/console app:user:list
```

En producción, los mismos comandos con `kubectl exec -n absorconnect deploy/absorconnect-php -- php bin/console …`.

### Despliegue

Jenkins construye la imagen `absortian/absortian:php-absorconnect-1.0.0` (`docker/prod/php/Dockerfile`), aplica las migraciones con un Job y despliega 3 réplicas en Kubernetes (`kube/`, NodePort 30081). Un proyecto nuevo necesita además, una sola vez: la base de datos, el Secret `absorconnect-env`, el job de Jenkins (`Deploy AbsorConnect`), el registro en Cloudflare y la ruta en el HAProxy de `head0`. Todo eso ya está hecho para AbsorConnect; los pasos están en [`kube/AGENTS.md`](kube/AGENTS.md#primer-despliegue).

## Plataformas soportadas

- **macOS** — ARM64 (Apple Silicon), formatos DMG y ZIP
- **Windows** — Instalador NSIS
- **Linux** — AppImage, Snap y DEB
- **Android** — 7.0 o posterior, APK (fuera de Google Play)
- **iPhone y iPad** — iOS 15 o posterior, IPA para instalar con AltStore, SideStore o Sideloadly (fuera de la App Store)

## Seguridad

- **Credenciales en el servicio:** las claves y contraseñas de las conexiones viajan por HTTPS y se guardan cifradas con una clave del servicio (`CONNECTIONS_KEY`). Quien tuviera a la vez la base de datos y esa clave podría leerlas. De las claves privadas SSH solo se guarda la ruta del fichero, nunca su contenido; en el móvil la clave se importa en cada dispositivo y se guarda en su almacén seguro (Keychain o Keystore).
- **Sesión en el equipo:** el token de sesión se guarda cifrado con el almacén seguro del sistema (Llavero, DPAPI o libsecret/kwallet). En Linux sin keyring se guarda sin cifrar y Ajustes lo indica. Cambiar la contraseña cierra las sesiones de los demás equipos.

- **Host key SSH sin verificar:** Absor Connect acepta la clave de host de cualquier servidor SSH sin comprobarla. Es una decisión consciente para esta versión, pero implica que en una red no confiable un atacante podría suplantar al servidor (man-in-the-middle) y capturar la contraseña o los datos transferidos. Usa autenticación por clave privada y redes de confianza siempre que puedas.
- **Exportación de conexiones:** el fichero exportado contiene todas las credenciales sin cifrar.

## Actualizar desde una versión sin cuenta

Hasta la v0.1.1 las conexiones se guardaban en el equipo (`connections.json`). Al actualizar hay que crear una cuenta o iniciar sesión, y la app ofrece subir esas conexiones a la cuenta:

- **Subir a mi cuenta:** se añaden a las que ya tuviera la cuenta y, solo si la subida va bien, se borran `connections.json` y `connections.json.bak` del equipo. Las credenciales que el equipo no podía leer se suben marcadas para volver a introducirlas.
- **Ahora no:** el fichero queda intacto y se vuelve a preguntar en el siguiente inicio de sesión.
- Si el fichero está dañado, se aparta a `connections.json.corrupt-<fecha>` y la app indica dónde está la copia.

## Historial

Hasta la v0.0.7 la aplicación se llamaba **Absor S3 Explorer** y el repositorio era `absortian/AbsorS3Explorer`. Las instalaciones de esas versiones siguen buscando actualizaciones en esa ruta y GitHub las redirige a `absortian/AbsorConnect`, así que **no se debe crear un repositorio nuevo llamado `AbsorS3Explorer`**: rompería la redirección y esas instalaciones dejarían de recibir actualizaciones.
