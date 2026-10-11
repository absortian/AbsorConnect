# Proposal

## Why

El instalador de Windows generado con el NSIS por defecto de electron-builder (3.0.4.1, de 2019) se cuelga con una violación de acceso (`0xc0000005` en el plugin `System.dll`) en torno al **20 %** de las instalaciones silenciosas en Windows Server 2025, la base de Windows 11 24H2. En Windows Server 2022 no ocurre. La instalación silenciosa es la que usa el auto-update, así que un usuario de Windows 11 reciente podría quedarse sin actualizar, o sin la app, si falla a mitad. Se detectó al verificar `add-sftp-connections` y `add-ssh-terminal`, y se confirmó con 88 instalaciones en runners de GitHub Actions.

## What Changes

- Actualizar electron-builder de 26.8.1 a **26.15.3**.
- Compilar el instalador con **NSIS 3.12** (`toolsets.nsis: '1.2.1'` en `electron-builder.yml`) en lugar del NSIS 3.0.4.1 heredado.

## Fuera de alcance

- Firmar el instalador o la app de Windows.
- Cambiar el tipo de instalador (sigue siendo NSIS oneClick por usuario) o sus opciones.
- Cambios en macOS o Linux más allá de los que traiga la actualización de electron-builder.

## Impacto en usuarios existentes

- **Instalaciones de Windows existentes:** el instalador nuevo actualiza en el sitio las instalaciones hechas con el NSIS antiguo (verificado sobre la v0.1.0 publicada). Mismo GUID y misma carpeta.
- **Datos, credenciales y auto-update:** ninguno.
- **macOS y Linux:** se empaquetan con la nueva versión de electron-builder, sin cambios de configuración.

## Capabilities

### New Capabilities
(ninguna)

### Modified Capabilities
- `app-updates`: nuevo requisito de instalación silenciosa fiable en Windows, de la que depende el auto-update.

## Impact

- **Empaquetado:** `package.json` y `package-lock.json` (electron-builder 26.15.3) y `electron-builder.yml` (`toolsets.nsis`).
- **CI:** sin cambios en `release.yml`; electron-builder descarga el bundle de NSIS 3.12 al compilar.
