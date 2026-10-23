# Proposal

## Why

El propietario observó tirones al controlar Windows desde un iPad. La captura
actual envía la resolución del monitor sin límite y prioriza conservarla incluso
cuando reduce los fotogramas; en las pruebas artificiales documentadas, 4K bajó a
11–12 fps con un presupuesto de codificación de 1 Mbit/s, frente a unos 30 fps a
1080p. Esto no identifica la causa de aquella sesión, pero sí una carga evitable.

## What Changes

- Limitar la captura inicial a un sobre de 1920×1080 y 30 fps, conservando aspecto
  y coordenadas de entrada sobre todo el monitor.
- Ofrecer perfiles Equilibrado, Fluido y Resolución original durante la sesión,
  desde escritorio y móvil, sin volver a autenticar ni cambiar de monitor.
- Negociar esa función mediante una extensión opcional del protocolo v1; los
  clientes anteriores continúan funcionando y no reciben comandos nuevos.
- Mostrar resolución recibida, tasa de vídeo y retardo de reproducción junto a
  los datos existentes, usando estadísticas agregadas en memoria, sin telemetría.
- Verificar cambios de perfil, transporte directo/TURN y rechazo antes de
  autenticar; publicar únicamente las mejoras que pasen sus pruebas.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `remote-access-host`: perfiles de captura y codificación, selección serializada
  y autorización previa.
- `remote-desktop-viewer`: selector de perfil negociado y diagnóstico de vídeo.
- `mobile-app`: mismos perfiles y estadísticas en Android/iOS.

## Impact

Host oculto Electron, protocolo TypeScript/Dart, visores de escritorio y Flutter,
traducciones, pruebas y documentación. Sin nuevas dependencias ni cambios en API,
datos de usuario, credenciales, firma o mecanismo de actualización. Se mantiene
la instalación manual de actualizaciones Mac con firma ad-hoc. El propietario
autorizó implementación y publicación el 23/10/2026.

## Fuera de alcance

Este cambio no certifica acceso desatendido, UAC, bloqueo o inicio de sesión; esas
capacidades siguen en `add-unattended-admin-access`. Tampoco promete una latencia
universal, elimina límites de red ni cambia la seguridad del relé. La causa de
los tirones históricos sigue sin confirmar.
