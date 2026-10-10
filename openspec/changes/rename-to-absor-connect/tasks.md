# Tasks

## 1. Empaquetado y configuración

- [x] 1.1 En `electron-builder.yml`: `productName: Absor Connect` y `win.executableName: AbsorConnect`, sin tocar `appId` (`com.absor.fileexplorer`). Verificar: `grep -n -E "productName|executableName|appId" electron-builder.yml` muestra los valores nuevos y el `appId` intacto.
- [x] 1.2 Sustituir `${name}` por el prefijo literal `absor-connect` en las plantillas `artifactName` (`nsis`, `mac`, `dmg`, `appImage`, `rpm`) y añadir `linux.artifactName: absor-connect-${version}-${arch}.${ext}` para que `deb` y `tar.gz` también lo lleven (D2). Verificar: `grep -n artifactName electron-builder.yml` no contiene `${name}`.
- [x] 1.3 Cambiar `publish.repo` a `AbsorConnect` en `electron-builder.yml`, y `homepage` y `repository.url` a `https://github.com/absortian/AbsorConnect` en `package.json`, manteniendo `"name": "absor-file-explorer"` (D1/D3). Verificar: `node -p "require('./package.json').name"` devuelve `absor-file-explorer`.
- [x] 1.4 En `.github/workflows/release.yml`, cambiar el título del cuerpo de la release a "Absor Connect" y añadir una sección "Migración desde Absor S3 Explorer" con la nota de macOS (borrar "Absor S3 Explorer.app" tras instalar). Verificar: el YAML sigue siendo válido (`npx --yes yaml-lint .github/workflows/release.yml` o revisión en la pestaña Actions).

## 2. Main y shared

- [x] 2.1 Crear `src/shared/constants.ts` con `RELEASES_URL = 'https://github.com/absortian/AbsorConnect/releases'` y usarlo en `src/main/updater.ts` en lugar de la constante local. Verificar: `npm run typecheck:node` pasa.
- [x] 2.2 En `src/main/index.ts`, cambiar `electronApp.setAppUserModelId('com.electron')` por `'com.absor.fileexplorer'` (D4). Verificar: `git grep -n "com.electron"` no devuelve nada.

## 3. Renderer

- [x] 3.1 `src/renderer/index.html`: `<title>Absor Connect</title>`. Verificar: con `npm run dev` la ventana se titula "Absor Connect".
- [x] 3.2 En `src/renderer/src/locales/en.json` y `es.json`: `app.title` → "Absor Connect" y `app.welcomeTitle` → "Welcome to Absor Connect" / "Bienvenido a Absor Connect". Verificar: con `npm run dev`, la cabecera y la bienvenida muestran el nombre nuevo en los dos idiomas (cambiando el idioma en Ajustes).
- [x] 3.3 En `src/renderer/src/components/SettingsPanel.tsx`, sustituir las dos URLs fijas de releases por `RELEASES_URL` de `src/shared/constants.ts`. Verificar: `npm run typecheck:web` pasa y `git grep -n "AbsorS3Explorer" src/` no devuelve nada.

## 4. Documentación

- [x] 4.1 En `README.md`, cambiar el título a "Absor Connect", añadir una línea "(antes Absor S3 Explorer)" y una nota de historial que diga que el repo se llamaba `AbsorS3Explorer` y que ese nombre no debe reutilizarse porque rompería la redirección del auto-update. Verificar: lectura del README renderizado.

## 5. Verificación

- [x] 5.1 `npm run typecheck` pasa, y `npx eslint src/main/updater.ts src/main/index.ts src/shared/constants.ts src/renderer/src/components/SettingsPanel.tsx` no tiene más errores que en `main` (comparar con `git stash` o con el recuento previo).
- [x] 5.2 Comprobar que no quedan restos del nombre: `git grep -n -E "S3 Explorer|File Explorer|Absor Explorer|AbsorS3Explorer" -- ':!openspec'` solo devuelve menciones históricas (README y la sección "Migración desde Absor S3 Explorer" de `release.yml`).
- [x] 5.3 (manual, macOS) `npm run build:mac`: en `dist/` aparecen `absor-connect-<versión>-arm64.dmg` y `absor-connect-<versión>-x64.dmg`. La app montada se llama "Absor Connect.app" y `defaults read "/Volumes/…/Absor Connect.app/Contents/Info" CFBundleIdentifier` devuelve `com.absor.fileexplorer`.
- [ ] 5.4 (manual, macOS) Continuidad de datos y credenciales: instalar la v0.0.7 desde Releases, crear una conexión con credenciales de prueba y cerrarla. Instalar el build de 5.3 y abrirlo. La conexión aparece, el formulario de edición muestra las claves descifradas y el tema y el idioma se conservan. Si falla, parar y reabrir la decisión D1 del design.
- [ ] 5.5 (manual, Windows, en VM o con el artefacto de CI) Instalar la v0.0.7, crear una conexión y ejecutar `absor-connect-<versión>-setup.exe`. En "Aplicaciones instaladas" hay una sola entrada, "Absor Connect", y desaparecen los atajos "Absor S3 Explorer". La conexión sigue ahí.
- [ ] 5.6 (manual, Linux, en VM o con el artefacto de CI) Con la v0.0.7 instalada por `.deb`, instalar `absor-connect-<versión>-amd64.deb`. `dpkg -l absor-file-explorer` muestra la versión nueva, el menú muestra "Absor Connect" y las conexiones se conservan.

## 6. Renombrado del repositorio (manual, propietario)

- [ ] 6.1 Renombrar en GitHub `absortian/AbsorS3Explorer` → `absortian/AbsorConnect` y ejecutar `git remote set-url origin https://github.com/absortian/AbsorConnect.git`. Verificar: `git fetch` funciona.
- [ ] 6.2 Verificar las redirecciones que usa el updater de la v0.0.7: `curl -sIL https://github.com/absortian/AbsorS3Explorer/releases.atom`, `curl -sIL https://api.github.com/repos/absortian/AbsorS3Explorer/releases/latest` y `curl -sIL https://github.com/absortian/AbsorS3Explorer/releases/download/v0.0.7/latest.yml` acaban en 200 bajo `AbsorConnect`.

## Workflow follow-up

- Al publicar la primera release con el nombre nuevo (tag `v0.1.0`, quizá junto a SFTP/SSH), comprobar extremo a extremo que una v0.0.7 en Windows detecta, descarga e instala la actualización. En macOS, comprobar que detecta la versión y ofrece el enlace a Releases.
- Archivar el change (`/opsx:archive`) cuando todo lo anterior esté verificado, para que `app-identity` y `app-updates` pasen a `openspec/specs/`.
