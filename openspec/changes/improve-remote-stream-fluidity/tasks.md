# Tasks

El propietario autoriza implementar y publicar el 23/10/2026. La mejora de
fluidez se publica por separado del acceso desatendido, que conserva todo su
alcance y sus pruebas pendientes.

## 1. Protocolo compartido

- [x] 1.1 Añadir perfiles enumerados, capacidad opcional, petición y confirmación en TypeScript y Dart; verificar versiones/perfiles inválidos y compatibilidad con mensajes anteriores mediante Vitest y Flutter, documentando el contrato.

## 2. Host y renderer de escritorio

- [x] 2.1 Aplicar perfiles a captura/codificación, serializar monitor/perfil y detener capturas tardías; verificar rechazo antes de autenticar, cambio rechazado, orden y cierre durante espera con pruebas del ciclo de vida.
- [x] 2.2 Añadir selector negociado y confirmación en el visor, con textos españoles/ingleses; verificar reconexión, host anterior y preservación de coordenadas normalizadas.
- [x] 2.3 Incorporar estadísticas locales por intervalo y mostrarlas con unidades inequívocas; verificar contadores reiniciados, valores ausentes/no finitos, fallos de consulta y resultados tardíos sin persistencia ni API nueva.

## 3. Controlador Flutter

- [x] 3.1 Añadir selector y estadísticas equivalentes en Android/iOS con traducciones; verificar parser, negociación, reconexión y cálculos mediante Flutter y documentar perfiles en mobile/README.md.

## 4. Verificación integrada y publicación

- [x] 4.1 Comparar vídeo artificial 4K/original frente a Equilibrado/Fluido, registrar fps/dimensiones y vídeo recibido por Flutter; verificar directo y TURN sin presentar el resultado como reproducción física de la sesión histórica.
- [x] 4.2 Ejecutar npm run typecheck, npm test, lint de archivos tocados, flutter analyze y flutter test con su entorno, builds de escritorio/móvil y openspec validate improve-remote-stream-fluidity --strict; documentar resultados y límites en verification.md.
- [x] 4.3 Fusionar el cambio revisado y publicar release compatible de Windows/macOS/Linux/Android/iOS; verificar assets, manifiestos de actualización y salud de producción, con notas que mantengan los límites del acceso desatendido y rollback a la versión anterior.
