# Spec Delta

## ADDED Requirements

### Requirement: Calidad del escritorio remoto desde móvil
Android e iOS SHALL ofrecer los perfiles Equilibrado, Fluido y Resolución original con hosts que anuncien esa capacidad tras autenticar. MUST esperar confirmación del host, conservar la elección al reconectar y mantener compatibilidad sin selector con hosts anteriores.

#### Scenario: iPad con host actualizado
- **WHEN** se cambia de Equilibrado a Fluido desde la sesión remota
- **THEN** la sesión continúa y el móvil muestra el perfil confirmado por el host

#### Scenario: Android con host anterior
- **WHEN** el host no anuncia selección de calidad
- **THEN** Android conserva el control existente sin enviar comandos de calidad

### Requirement: Diagnóstico de vídeo móvil en memoria
El controlador móvil SHALL mostrar resolución, tasa recibida y retardo del búfer de reproducción cuando el motor los suministre. MUST calcular diferencias de contadores válidos, descartar resultados de conexiones cerradas y no guardar ni transmitir estadísticas, pantallas, credenciales o teclas como diagnóstico.

#### Scenario: Reconexión durante una consulta
- **WHEN** termina una consulta de estadísticas de una conexión sustituida
- **THEN** su resultado no modifica el estado de la conexión nueva

#### Scenario: Campos no disponibles
- **WHEN** una versión del motor omite campos de vídeo
- **THEN** los datos ausentes permanecen desconocidos y la sesión sigue funcionando
