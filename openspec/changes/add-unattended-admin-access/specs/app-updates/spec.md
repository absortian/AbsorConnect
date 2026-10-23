# Spec Delta

## MODIFIED Requirements

### Requirement: Actualizaciones con la app en segundo plano
Mientras la app esté en marcha, SHALL buscar actualizaciones al arrancar y cada 6 horas. Si hay una versión nueva, MUST avisar con una notificación del sistema y en el menú de la bandeja, e instalarla al salir de la app si ya se descargó. MUST NOT reiniciarse ni sustituir el agente automáticamente durante una sesión remota. Con servicio instalado, salir de la interfaz MUST NOT instalar unilateralmente una actualización incompatible del host.

#### Scenario: Versión nueva con la app en la bandeja
- **WHEN** la app lleva días en segundo plano y se publica una versión nueva
- **THEN** en menos de 6 horas aparece una notificación y el menú de la bandeja ofrece descargarla

#### Scenario: Sesión remota en curso
- **WHEN** una actualización termina de descargarse mientras otro equipo controla este PC
- **THEN** la app no se reinicia y la sesión continúa

## ADDED Requirements

### Requirement: Actualización coordinada del agente
El actualizador SHALL verificar integridad, origen autorizado y compatibilidad entre app y agente antes de sustituir ejecutables del servicio. MUST conservar la versión funcional si la actualización falla y MUST NOT ampliar permisos. Los binarios y sus metadatos de actualización MUST estar protegidos contra sustitución por usuarios locales sin privilegios.

#### Scenario: Paquete manipulado
- **WHEN** se intenta instalar un paquete cuyo origen o integridad no puede verificarse
- **THEN** se rechaza y permanece la versión anterior sin ejecutar el paquete

#### Scenario: Fallo a mitad de actualización
- **WHEN** la actualización del agente falla antes de completar su comprobación de salud
- **THEN** se restaura la versión funcional con su configuración protegida y el propietario ve el fallo

#### Scenario: Firma o permiso nuevo
- **WHEN** una actualización necesita una nueva autorización del sistema
- **THEN** se informa de la intervención necesaria sin simular una instalación silenciosa ni cambiar permisos automáticamente
