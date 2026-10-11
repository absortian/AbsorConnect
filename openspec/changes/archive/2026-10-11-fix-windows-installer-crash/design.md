# Design

## Context

Ver proposal.md (Why). La investigación instaló en silencio el instalador publicado de la v0.1.0 en runners nuevos de GitHub Actions: una primera instalación y 10 ciclos de instalar y desinstalar por runner.

| Runner | NSIS 3.0.4.1 (por defecto) | NSIS 3.12 (`toolsets.nsis: '1.2.1'`) |
|---|---|---|
| Windows Server 2025 | 9 fallos de 44 | 0 de 44 |
| Windows Server 2022 | 0 de 44 | 0 de 22 |

Todos los fallos son `0xc0000005` en `System.dll`, extraído por el instalador en `%TEMP%\ns*.tmp`, según el evento 1000 del registro de aplicación.

## Goals / Non-Goals

**Goals:** eliminar el fallo con el menor cambio posible en el empaquetado.

**Non-Goals:** cambiar el modo del instalador, las plantillas NSIS o la firma.

## Decisions

### D1. NSIS 3.12 mediante `toolsets.nsis`
electron-builder 26.15.3 expone `toolsets.nsis`. `'0.0.0'` (el valor por defecto) es el NSIS 3.0.4.1 heredado, y `'1.2.1'` es un bundle unificado con makensis 3.12 y sus plugins, publicado en electron-builder-binaries como `nsis@1.2.1`.

electron-builder marca la opción como *beta*. Se adopta igualmente por la evidencia: elimina un fallo reproducible y real, y el instalador resultante pasa las mismas pruebas de instalación y actualización.

*Alternativas descartadas:*
- **Seguir con 3.0.4.1 y reintentar la instalación:** el auto-update no reintenta, y el usuario vería un fallo.
- **`customNsisBinary` con un NSIS propio:** obliga a mantener nosotros el binario y su checksum.

### D2. Actualizar electron-builder a 26.15.3
`toolsets.nsis: '1.2.1'` solo existe en las versiones recientes de electron-builder. Se actualiza dentro de la misma versión mayor (26.x) y se verifica que macOS y Linux siguen empaquetando igual.

## Risks / Trade-offs

- **[Toolset beta]** Un cambio futuro de electron-builder podría alterarlo. → La versión está fijada (`'1.2.1'`) y cualquier subida de electron-builder se verificará con la misma prueba de instalación.
- **[Regresiones en macOS o Linux por la subida de electron-builder]** → Se verifica construyendo los paquetes en los dos sistemas (tareas).
