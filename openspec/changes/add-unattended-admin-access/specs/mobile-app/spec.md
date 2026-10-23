# Spec Delta

## ADDED Requirements

### Requirement: Administración de hosts desatendidos desde el móvil
Android e iOS SHALL mostrar las capacidades del agente y permitir bloqueo, cierre de sesión del sistema, reinicio y atención segura de Windows cuando estén anunciados. MUST pedir confirmación antes de cerrar sesión o reiniciar. MUST mostrar el contexto protegido, deshabilitando sonido, portapapeles y ficheros en él, y MUST permitir introducir credenciales mediante teclado.

#### Scenario: Administrar Windows desde un teléfono
- **WHEN** el propietario abre una herramienta que solicita UAC en un Windows preparado
- **THEN** puede ver y manejar el aviso y la herramienta elevada con los controles táctiles y el teclado del móvil

#### Scenario: Iniciar sesión en Mint desde el móvil
- **WHEN** un Mint preparado muestra LightDM y la conexión está autenticada
- **THEN** el propietario puede introducir sus credenciales y acceder al escritorio Cinnamon

#### Scenario: Iniciar sesión en Mac desde el móvil
- **WHEN** un Mac certificado muestra la ventana de inicio de sesión y la conexión está autenticada
- **THEN** el propietario puede ver la pantalla e introducir sus credenciales sin teclado local

### Requirement: Reconexión administrativa desde el móvil
Con la app en primer plano, el móvil SHALL esperar hasta 5 minutos el regreso del mismo host tras un reinicio solicitado, permitir cancelar y exigir prueba nueva de contraseña. Al pasar a segundo plano MUST conservar el límite actual de 30 segundos y no prometer espera ni reconexión automática en segundo plano.

#### Scenario: Reinicio desde Android o iOS
- **WHEN** el propietario confirma reiniciar y mantiene la app en primer plano hasta que vuelve el equipo
- **THEN** ve la espera y debe autenticarse de nuevo antes de acceder al equipo reiniciado

#### Scenario: Host anterior
- **WHEN** el móvil se conecta a un host que solo anuncia el protocolo actual
- **THEN** conserva imagen, entrada y funciones actuales sin ofrecer las operaciones administrativas nuevas

### Requirement: Revocación de acceso desde el móvil
La lista de equipos del móvil SHALL permitir revocar el acceso desatendido de un equipo propio con confirmación y mostrar el resultado del servicio. MUST NOT requerir acceso al sistema operativo de ese equipo para revocarlo.

#### Scenario: Revocar durante un viaje
- **WHEN** el propietario confirma desde el móvil la revocación de un agente
- **THEN** el servicio invalida su credencial y la lista refleja el resultado sin borrar las conexiones S3/SSH
