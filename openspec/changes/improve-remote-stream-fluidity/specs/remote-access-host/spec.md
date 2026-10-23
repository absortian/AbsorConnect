# Spec Delta

## ADDED Requirements

### Requirement: Perfiles de vídeo autorizados
El host SHALL comenzar cada sesión con el perfil Equilibrado, limitado a 1920×1080 y 30 fps conservando el aspecto. MUST aceptar los perfiles Fluido y Resolución original solo después de autenticar y anunciar la capacidad de selección, sin cambiar permisos, monitor ni coordenadas de entrada.

#### Scenario: Monitor de alta resolución
- **WHEN** empieza una sesión autenticada en un monitor 4K con un cliente anterior o nuevo
- **THEN** la captura inicial permanece dentro de 1920×1080 sin recortar el monitor y los clics corresponden a la imagen completa

#### Scenario: Perfil fluido
- **WHEN** un controlador autenticado selecciona Fluido
- **THEN** el host limita la captura a 1280×720 y 30 fps y prioriza mantener la frecuencia frente a la resolución

#### Scenario: Resolución original
- **WHEN** un controlador autenticado selecciona Resolución original
- **THEN** el host permite la resolución de la fuente y prioriza su detalle, indicando que depende del rendimiento y de la red

#### Scenario: Solicitud anterior a la contraseña
- **WHEN** llega una selección de perfil antes de autenticar
- **THEN** el host la ignora y no inicia captura ni acepta entrada

### Requirement: Cambios de captura consistentes
El host MUST procesar en orden los cambios de monitor y perfil, conservar el perfil al cambiar de monitor y confirmar el perfil aplicado. Un fallo de ajuste MUST mantener la sesión con el vídeo anterior cuando sea posible; el cierre MUST detener toda captura incluso si había un cambio en curso.

#### Scenario: Cambios sucesivos
- **WHEN** se eligen dos perfiles y después otro monitor mientras se ajusta la captura
- **THEN** el resultado corresponde al último perfil y al monitor elegido, sin pistas huérfanas

#### Scenario: Perfil no disponible
- **WHEN** el sistema rechaza un cambio de restricciones
- **THEN** la sesión conserva el vídeo utilizable y el controlador no presenta el perfil rechazado como aplicado
