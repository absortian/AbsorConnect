# Proposal

## Why

Al abrir la app de macOS descargada de la web, macOS decía que «Absor Connect» está dañado y no se puede abrir, y no ofrecía «Abrir igualmente». Sin certificado de Apple, el empaquetado no firmaba la app y el ejecutable quedaba con una firma incompleta, que macOS trata como un paquete dañado.

## What Changes

- La app de macOS se firma **ad-hoc** al empaquetarla (sin certificado ni cuenta de Apple), así su firma es válida y macOS ofrece el aviso normal de app sin verificar, con «Abrir igualmente».
- La web aclara que el mensaje «está dañada» era de las versiones hasta la 0.3.1 y mantiene el comando de Terminal para ellas.
- `AGENTS.md` explica por qué no hay que quitar la firma ad-hoc.

## Capabilities

### New Capabilities
- `desktop-distribution`: cómo se instala y se abre la app de escritorio descargada de la web sin certificados de las plataformas.

### Modified Capabilities
<!-- Ninguna: las actualizaciones automáticas en macOS ya ofrecen la descarga manual si fallan por la firma (app-updates). -->

## Impact

- **Empaquetado:** `electron-builder.yml` (`mac.identity: '-'`). Windows y Linux no cambian.
- **Web:** nota de macOS en `backend/public/index.html`.
- **Usuarios existentes:** sin cambios en datos ni credenciales. Quien tenga la v0.3.1 o anterior en macOS puede seguir usándola; para la v0.3.2 descarga el `.dmg` nuevo. Las actualizaciones automáticas en macOS siguen sin poder instalarse solas (hace falta el mismo certificado entre versiones) y la app ofrece el enlace de descarga, como hasta ahora.

## Fuera de alcance

- Firmar con un certificado Developer ID y notarizar la app (requiere la cuenta de Apple Developer de pago).
- Firmar el instalador de Windows.
- Instalar actualizaciones automáticas en macOS sin certificado.
