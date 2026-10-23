# Spec Delta

## ADDED Requirements

### Requirement: Selección de calidad negociada
El visor SHALL ofrecer Equilibrado, Fluido y Resolución original cuando el host anuncie la capacidad después de autenticar. MUST indicar el perfil confirmado por el host, mantener la elección al reconectar con un host compatible y ocultar el selector con versiones anteriores.

#### Scenario: Cambiar calidad sin desconectar
- **WHEN** se selecciona Fluido durante una sesión con un host compatible
- **THEN** la sesión continúa y el selector refleja el cambio tras confirmarlo el host

#### Scenario: Host anterior
- **WHEN** el host no anuncia selección de calidad
- **THEN** el visor conserva el control remoto existente sin enviar selecciones de calidad

### Requirement: Estadísticas de reproducción privadas
El visor SHALL mostrar resolución recibida, tasa de vídeo y retardo medio del búfer de reproducción junto a ruta, RTT y fps cuando estén disponibles. MUST calcular tasas por intervalo, distinguirlas de la latencia de entrada y no guardar ni enviar estas estadísticas a la API.

#### Scenario: Contadores reiniciados
- **WHEN** una reconexión o sustitución de pista reinicia los contadores
- **THEN** el visor reinicia la referencia y no muestra tasas negativas ni reutiliza datos de la sesión anterior

#### Scenario: Estadística ausente
- **WHEN** el motor WebRTC omite un contador o falla una consulta
- **THEN** el visor mantiene la sesión sin mostrar un cero ficticio ni provocar un rechazo de promesa sin tratar
