# Tasks

## 1. Empaquetado

- [x] 1.1 `mac.identity: '-'` en `electron-builder.yml`, con `hardenedRuntime: false` y el motivo en un comentario (D1).

## 2. Web y documentación

- [x] 2.1 Nota de macOS en la web: el mensaje «está dañada» era de las versiones hasta la 0.3.1, con el comando de Terminal para ellas.
- [x] 2.2 `AGENTS.md`: por qué no quitar la firma ad-hoc y su efecto en las actualizaciones de macOS (D2).

## 3. Verificación

- [x] 3.1 Comprobar la v0.3.1 publicada: `codesign --verify --deep --strict` da «code has no resources but signature indicates they must be present».
- [x] 3.2 Compilar en local `electron-builder --mac zip --arm64`: `codesign --verify --deep --strict` da «valid on disk» y «satisfies its Designated Requirement», y con cuarentena Gatekeeper lo rechaza sin error de firma (flujo «Abrir igualmente»).
- [x] 3.3 Publicar la v0.3.2 y repetir la comprobación de firma sobre el `.zip` y el `.dmg` publicados, de arm64 y x64.
- [x] 3.4 `npm run typecheck` sin errores; los ficheros tocados (YAML, HTML y Markdown) no pasan por ESLint.
