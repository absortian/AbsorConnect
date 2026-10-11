# Tasks

## 1. Empaquetado

- [x] 1.1 Actualizar electron-builder a 26.15.3 (`package.json` y `package-lock.json`). Verificar: `npm ls electron-builder` muestra la 26.15.3.
- [x] 1.2 Añadir `toolsets.nsis: '1.2.1'` a `electron-builder.yml`, con un comentario que explique el motivo. Verificar: el YAML es válido y el build de Windows usa el bundle `nsis@1.2.1`.

## 2. Verificación

- [x] 2.1 (CI) Instalador compilado con NSIS 3.12: 11 instalaciones silenciosas por runner en 4 runners Windows Server 2025 y 2 Windows Server 2022, todas con código 0, app instalada y sin eventos de fallo; además, actualización sobre la v0.1.0 publicada con una sola entrada y la versión nueva (run 38162258446).
- [x] 2.2 `npm run build:mac` con electron-builder 26.15.3 genera los DMG y ZIP, y la app empaquetada arranca.
- [ ] 2.3 (Linux, VM de OrbStack) El `.deb` se construye con electron-builder 26.15.3, se instala y la app arranca.
- [x] 2.4 `npm run typecheck` pasa.

## Workflow follow-up

- Archivar el change para añadir el requisito a `app-updates` en `openspec/specs/`.
