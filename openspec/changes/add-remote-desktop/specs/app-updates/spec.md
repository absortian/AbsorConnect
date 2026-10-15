# Spec Delta

## ADDED Requirements

### Requirement: Actualizaciones con la app en segundo plano
Mientras la app esté en marcha, SHALL buscar actualizaciones al arrancar y cada 6 horas. Si hay una versión nueva, MUST avisar con una notificación del sistema y en el menú de la bandeja, e instalarla al salir de la app si ya se descargó. MUST NOT reiniciarse sola durante una sesión de control remoto.

#### Scenario: Versión nueva con la app en la bandeja
- **WHEN** la app lleva días en segundo plano y se publica una versión nueva
- **THEN** en menos de 6 horas aparece una notificación y el menú de la bandeja ofrece descargarla

#### Scenario: Sesión remota en curso
- **WHEN** una actualización termina de descargarse mientras otro equipo controla este PC
- **THEN** la app no se reinicia y la sesión continúa
