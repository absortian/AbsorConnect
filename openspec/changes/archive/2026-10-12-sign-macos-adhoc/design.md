# Design

## Context

Sin `identity` en `electron-builder.yml`, electron-builder busca un certificado en el llavero y, si no hay ninguno (caso de CI), se salta la firma. El binario de Electron conserva solo la firma del enlazador (`adhoc,linker-signed`, identificador `Electron`) sin recursos sellados. Al cambiar el `Info.plist` y añadir la app, `codesign --verify` falla con «code has no resources but signature indicates they must be present». Con el atributo de cuarentena de una descarga, Gatekeeper trata la firma rota como un paquete dañado.

## Goals / Non-Goals

**Goals:**
- Firma válida en las dos arquitecturas de macOS (arm64 y x64) sin certificado.
- Que la primera apertura siga el flujo normal de macOS para apps sin verificar.

**Non-Goals:**
- Notarización o firma Developer ID (ver Fuera de alcance en la propuesta).

## Decisions

### D1. Firma ad-hoc con `identity: '-'`
electron-builder 26 lo documenta como la forma explícita de firmar ad-hoc. Firma el `.app` antes de crear el `.dmg` y el `.zip`, así que los dos llevan la misma firma.
- **macOS:** `identity: '-'` y `hardenedRuntime: false`. Con hardened runtime y firma ad-hoc haría falta el entitlement `disable-library-validation`; sin hardened runtime no hace falta.
- **Windows:** sin cambios (el instalador sigue sin firmar; SmartScreen avisa y deja continuar).
- **Linux:** sin cambios (no hay firma de código en AppImage, deb ni rpm).
- **Alternativa descartada:** firmar con `codesign --force --deep --sign -` en un `afterSign` propio. Repite lo que electron-builder ya hace y deja el `.zip` de auto-update sin coherencia con el `.dmg`.

### D2. Actualizaciones automáticas en macOS
Con firma ad-hoc, el requisito designado es el hash exacto del código (`cdhash`), distinto en cada versión, así que Squirrel.Mac no puede instalar una versión nueva encima. Ya pasaba antes con la firma rota. La app ya ofrece el enlace de descarga cuando la instalación falla por la firma (spec `app-updates`), así que no cambia nada en la app.

## Risks / Trade-offs

- **[Sin notarizar]** macOS sigue avisando la primera vez. → La web explica «Abrir igualmente». Para quitar el aviso hace falta el certificado de pago.
- **[Actualizaciones manuales en macOS]** Cada versión se descarga a mano. → El enlace de descarga de la app lo cubre.
