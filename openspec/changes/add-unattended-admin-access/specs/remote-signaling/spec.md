# Spec Delta

## ADDED Requirements

### Requirement: Alta limitada del agente
Solo una sesión de cuenta válida SHALL autorizar el alta de un agente para un equipo propio. La autorización de alta MUST ser de un solo uso, caducar en 5 minutos y vincular cuenta, equipo y sesión de origen. El servicio MUST conservar solo hashes de credenciales y rechazar la reutilización del alta.

#### Scenario: Reutilizar un alta
- **WHEN** se intenta canjear por segunda vez la autorización de alta
- **THEN** se rechaza sin emitir otra credencial ni modificar el propietario del equipo

### Requirement: Alcance de la credencial del agente
Una credencial de agente SHALL permitir únicamente anunciar el estado del propio equipo, consultar y responder sus solicitudes y obtener sus servidores ICE. MUST NOT listar otros equipos, crear solicitudes como controlador, acceder a conexiones S3/SSH ni gestionar cuentas. Cada operación MUST comprobar cuenta y equipo, también al responder solicitudes.

#### Scenario: Leer conexiones con credencial de agente
- **WHEN** una credencial válida de agente intenta leer o modificar conexiones de la cuenta
- **THEN** recibe una denegación y no se revela ningún dato de las conexiones

#### Scenario: Responder por otro equipo
- **WHEN** un agente intenta responder a una solicitud de otro equipo de su misma cuenta
- **THEN** se rechaza igual que una solicitud inexistente

### Requirement: Revocación y caducidad del agente
El propietario SHALL poder revocar un agente desde un controlador actualizado de su cuenta. Cerrar la sesión de AbsorConnect que lo dio de alta, invalidarla o borrar la cuenta MUST revocarlo. La credencial MUST caducar tras 90 días sin uso; el uso válido renueva ese plazo. Un agente revocado MUST NOT poder renovar su acceso ni darse de alta sin autorización nueva.

#### Scenario: Revocación remota
- **WHEN** el propietario revoca el acceso de un equipo en línea
- **THEN** el servicio rechaza sus siguientes operaciones y el agente corta la conexión remota en un máximo de 30 segundos

#### Scenario: Revocación sin red
- **WHEN** se revoca un agente y este no puede consultar el servicio
- **THEN** el agente termina su autorización activa como máximo 30 segundos después de su última validación y exige validarla de nuevo antes de aceptar conexiones

### Requirement: Capacidades del equipo
El servicio SHALL publicar opcionalmente el modo, versión de agente y capacidades verificadas de administración, pantalla de entrada, atención segura y reinicio de cada equipo. La ausencia de esos datos MUST significar host anterior sin funciones nuevas. MUST conservar los campos y estados actuales para los clientes anteriores.

#### Scenario: Host anterior
- **WHEN** un host sin agente se registra con el contrato actual
- **THEN** se conserva su funcionamiento y un controlador nuevo no le ofrece capacidades administrativas por defecto

### Requirement: Límites y aislamiento del agente
Las operaciones del agente SHALL compartir con el modo de usuario los límites de consulta del propio equipo y de credenciales TURN de su cuenta. Una credencial de agente MUST NOT permitir eludir los bloqueos del equipo, el aislamiento entre cuentas, la caducidad de solicitudes ni el interruptor global de control remoto.

#### Scenario: Dos procesos del mismo equipo
- **WHEN** app y agente intentan consultar solicitudes por encima del límite conjunto
- **THEN** el servicio aplica el límite del equipo aunque las peticiones usen credenciales distintas
