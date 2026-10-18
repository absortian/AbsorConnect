# remote-signaling Specification

## Purpose
Define lo que aporta el servicio para el control remoto: el registro de los equipos de cada cuenta y su estado, el intercambio de la negociación de cada sesión, las credenciales temporales del relé TURN y los límites de uso. El contenido de las sesiones nunca pasa por el servicio.

## Requirements

### Requirement: Equipos de la cuenta
Cada instalación de la app de escritorio SHALL registrarse como un equipo de la cuenta con la sesión iniciada, con un identificador que se conserva entre reinicios, su nombre, sistema, versión de la app, estado del control remoto y funciones permitidas. Un identificador de otra cuenta MUST rechazarse.

#### Scenario: Primer registro
- **WHEN** una app con la sesión iniciada se registra por primera vez
- **THEN** el equipo aparece en la lista de equipos de la cuenta con sus datos

#### Scenario: Identificador de otra cuenta
- **WHEN** una petición intenta registrar un identificador que ya pertenece a otra cuenta
- **THEN** el servicio la rechaza con el código `device_taken` y el equipo de la otra cuenta no cambia

### Requirement: Estado en línea
Un equipo SHALL considerarse en línea si ha contactado con el servicio en los últimos 30 segundos. La lista de equipos MUST incluir, para cada uno, si está en línea y la fecha de su último contacto.

#### Scenario: App cerrada
- **WHEN** un equipo deja de contactar con el servicio porque la app se cerró
- **THEN** a los 30 segundos aparece como sin conexión en la lista

### Requirement: Aislamiento entre cuentas
El servicio SHALL limitar cada operación sobre equipos y solicitudes de sesión a los de la cuenta del token. Un equipo o una solicitud de otra cuenta MUST responder igual que uno inexistente.

#### Scenario: Equipo de otra cuenta
- **WHEN** una cuenta pide conectarse a un identificador de equipo de otra cuenta
- **THEN** el servicio responde `device_not_found`, como si no existiera

### Requirement: Negociación de las sesiones
El servicio SHALL guardar la solicitud de sesión de un controlador para un equipo en línea con el control remoto activado, entregarla a ese equipo cuando la consulte, y devolver al controlador su respuesta o su rechazo. Las solicitudes MUST caducar a los 60 segundos y borrarse.

#### Scenario: Equipo disponible
- **WHEN** un controlador crea una solicitud para un equipo disponible y el equipo responde
- **THEN** el controlador obtiene la respuesta en su siguiente consulta

#### Scenario: Equipo sin conexión
- **WHEN** un controlador crea una solicitud para un equipo sin conexión o con el control remoto desactivado
- **THEN** el servicio la rechaza con `device_offline` o `remote_disabled`

#### Scenario: Solicitud caducada
- **WHEN** un controlador consulta una solicitud creada hace más de 60 segundos sin respuesta
- **THEN** el servicio responde `remote_request_expired`

### Requirement: El contenido no pasa por el servicio
El servicio SHALL limitarse a los datos de la negociación (descripción de la sesión y candidatos de red) y MUST NOT recibir imagen, sonido, entrada, portapapeles, ficheros ni la contraseña del PC.

#### Scenario: Datos guardados de una sesión
- **WHEN** se inspecciona la base de datos del servicio durante una sesión activa
- **THEN** solo hay datos de negociación de solicitudes aún no caducadas

### Requirement: Credenciales del relé
El servicio SHALL dar a cualquier cuenta autenticada la lista de servidores STUN y TURN, con credenciales TURN temporales, firmadas con un secreto compartido con el relé, que caducan como mucho a las 24 horas. La caducidad MUST redondearse a la hora, para que la misma cuenta reciba el mismo usuario durante toda la hora y la cuota por usuario del relé limite a cada cuenta. Sin TURN configurado, MUST devolver solo los STUN.

#### Scenario: Credenciales caducadas
- **WHEN** alguien usa contra el relé unas credenciales emitidas hace más de 24 horas
- **THEN** el relé las rechaza

### Requirement: Límites de uso
El servicio SHALL limitar cada cuenta a 20 solicitudes de sesión por minuto y a 120 peticiones de credenciales del relé por hora, y cada equipo a una consulta por segundo. Al superar un límite, MUST responder `too_many_requests` con el tiempo de espera, con límites comunes a todas las réplicas.

#### Scenario: Demasiadas solicitudes
- **WHEN** una cuenta crea 21 solicitudes de sesión en un minuto
- **THEN** la vigésimo primera se rechaza con `too_many_requests` y el tiempo que hay que esperar

#### Scenario: Demasiadas credenciales del relé
- **WHEN** una cuenta pide credenciales del relé por 121.ª vez en una hora
- **THEN** se rechaza con `too_many_requests` y el tiempo de espera, y las demás cuentas siguen recibiéndolas

### Requirement: Retirada de equipos
Un equipo SHALL poder retirarse de la cuenta desde la app (al cerrar la sesión o al iniciar sesión con otra cuenta). Borrar la cuenta MUST borrar sus equipos y solicitudes, y los equipos sin contacto en 90 días MUST desaparecer.

#### Scenario: Borrar la cuenta
- **WHEN** alguien borra su cuenta
- **THEN** sus equipos y solicitudes de sesión desaparecen del servicio
