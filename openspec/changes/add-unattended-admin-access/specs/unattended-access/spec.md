# Spec Delta

## Purpose

Define el acceso remoto desatendido a equipos propios Windows, macOS y Mint, desde el arranque del sistema y durante operaciones administrativas, con instalación voluntaria, permisos verificables y revocación.

## ADDED Requirements

### Requirement: Instalación voluntaria por equipo
El acceso desatendido SHALL estar desactivado por defecto. Activarlo MUST requerir cuenta autenticada, contraseña de control remoto, autorización administrativa del sistema y permisos necesarios. Una actualización MUST NOT activarlo ni ampliar sus permisos. Cancelar la instalación MUST conservar el modo anterior.

#### Scenario: Instalación cancelada
- **WHEN** el propietario cancela la autorización del sistema durante el alta
- **THEN** el equipo conserva su configuración anterior y no aparece con acceso desatendido activo

#### Scenario: Confirmación local incompatible
- **WHEN** se activa el modo desatendido con la confirmación local de conexiones habilitada
- **THEN** se explica que requiere alguien delante y se pide elegir expresamente entre conservarla o permitir acceso sin confirmación; no se cambia silenciosamente

### Requirement: Disponibilidad sin sesión de usuario
Un equipo preparado SHALL aceptar conexiones autenticadas después de arrancar el sistema, con la interfaz cerrada, bloqueado o sin usuario conectado. Cerrar sesión en el sistema operativo MUST conservar el agente. Desbloquear el disco antes de arrancar y encender un equipo apagado quedan fuera de esta garantía.

#### Scenario: Viaje y reinicio
- **WHEN** se reinicia un equipo preparado y el sistema y la red vuelven a estar disponibles
- **THEN** en un máximo de 120 segundos el equipo permite volver a conectar a la pantalla de entrada sin abrir Electron ni iniciar sesión localmente

#### Scenario: Cerrar sesión del sistema
- **WHEN** el usuario cierra su sesión en Windows, macOS o Mint durante el control remoto
- **THEN** el agente sigue disponible y el controlador puede continuar o reconectar a la pantalla de entrada con autenticación nueva

### Requirement: Administración remota de Windows
Windows SHALL permitir controlar aplicaciones elevadas, los avisos del escritorio seguro de UAC y las pantallas de bloqueo e inicio de sesión mediante el agente autorizado. MUST conservar las comprobaciones y solicitudes de credenciales del sistema, sin aprobar elevaciones automáticamente.

#### Scenario: Instalador con UAC
- **WHEN** el propietario abre remotamente un instalador que solicita elevación
- **THEN** ve el aviso UAC, puede aceptarlo o cancelarlo y puede manejar el instalador elevado si el sistema autoriza la elevación

#### Scenario: Bloqueo y atención segura
- **WHEN** el equipo bloqueado requiere Ctrl+Alt+Supr para iniciar sesión
- **THEN** el controlador dispone de una acción específica admitida por Windows y puede introducir sus credenciales en la pantalla del sistema

### Requirement: Administración remota de macOS
macOS SHALL permitir operar los diálogos de autorización compatibles, la pantalla de bloqueo y el inicio de sesión con el agente y permisos autorizados. El soporte MUST certificarse para las versiones y arquitecturas publicadas; si no se ha demostrado una capacidad, MUST mostrarse como no verificada y el equipo no se declara preparado para acceso completo.

#### Scenario: Solicitud de administrador
- **WHEN** una operación muestra un diálogo de autorización compatible en un Mac preparado
- **THEN** el propietario puede introducir sus credenciales y completar o cancelar la operación, manteniendo los controles de macOS

#### Scenario: Entrada después de arrancar
- **WHEN** un Mac preparado termina de arrancar y muestra la ventana de inicio de sesión del sistema
- **THEN** el controlador puede autenticarse en AbsorConnect, ver esa ventana e iniciar sesión sin intervención local

### Requirement: Administración remota de Mint
Mint con Cinnamon/X11 y LightDM SHALL permitir controlar el escritorio existente, los diálogos de polkit, la pantalla de bloqueo y el acceso al sistema. MUST conservar la autenticación del sistema y MUST NOT habilitar acceso X11 global ni crear una sesión de escritorio distinta como sustituto del escritorio físico.

#### Scenario: Cambio administrativo
- **WHEN** una herramienta de Mint pide autenticación por polkit
- **THEN** el propietario puede completar o cancelar el diálogo desde la sesión remota

#### Scenario: LightDM y escritorio
- **WHEN** el propietario inicia sesión desde LightDM por control remoto
- **THEN** la conexión sigue o permite reconectar al escritorio Cinnamon del mismo equipo sin teclado o ratón bloqueados

### Requirement: Autoridad local limitada
El agente SHALL aceptar entrada y operaciones administrativas solo para una conexión autenticada y autorizada. MUST rechazar órdenes de procesos locales sin autorización y operaciones fuera de las capacidades concedidas. Disponer de un servicio privilegiado MUST NOT dar a un usuario local ordinario una consola o acceso arbitrario como administrador.

#### Scenario: Proceso local ajeno
- **WHEN** un proceso sin autorización intenta inyectar entrada, sustituir el agente o ejecutar una orden privilegiada por su canal local
- **THEN** la petición se rechaza sin ejecutarse y sin revelar secretos

### Requirement: Credenciales locales protegidas
El agente SHALL funcionar antes de iniciar sesión sin reutilizar el token completo de la cuenta ni depender del llavero interactivo del usuario. Sus secretos MUST quedar protegidos por el sistema y accesibles solo al servicio autorizado. Si no puede protegerlos, MUST rechazar el alta desatendida sin recurrir a texto claro.

#### Scenario: Almacén protegido no disponible
- **WHEN** la instalación no puede crear el almacén protegido del agente
- **THEN** informa de la causa, no habilita el modo y mantiene las credenciales del modo anterior intactas

### Requirement: Autenticación nueva y sesiones del sistema
El agente SHALL exigir la prueba de contraseña de equipo antes de capturar o aplicar entrada. Un reinicio del equipo o cambio de usuario del sistema MUST invalidar la autorización remota anterior y requerir una prueba nueva. Las credenciales del sistema MUST introducirse en su pantalla y MUST NOT almacenarse ni enviarse a la API de AbsorConnect.

#### Scenario: Cambiar de usuario
- **WHEN** durante una sesión se cambia a otro usuario del sistema
- **THEN** se descarta la autorización anterior, se liberan las teclas y se exige autenticación nueva antes de mostrar el escritorio del otro usuario

#### Scenario: Reutilizar una prueba antigua
- **WHEN** un controlador reutiliza después de reiniciar una prueba de contraseña de la sesión anterior
- **THEN** el agente la rechaza y no envía imagen ni aplica entrada

### Requirement: Recuperación del agente
El servicio SHALL recuperarse de un fallo de su proceso y de cortes de red sin necesitar la interfaz abierta. MUST limitar los reintentos, conservar los bloqueos por contraseñas fallidas y mantener una sola sesión remota activa por equipo. Detenerlo expresamente MUST NOT provocar su reactivación automática.

#### Scenario: Fallo durante una sesión
- **WHEN** el proceso del agente falla mientras hay teclas pulsadas
- **THEN** se libera o neutraliza la entrada pendiente, se termina la autorización y el servicio vuelve a estar disponible como máximo 120 segundos después si sistema y red lo permiten

### Requirement: Preparación para viajes
Ajustes SHALL mostrar por equipo la instalación y salud del agente, capacidades verificadas, permisos pendientes y resultado de la prueba de reconexión tras reinicio. MUST distinguir «preparado», «requiere intervención» y «no verificado», y explicar dependencias de arranque, red, suspensión y cifrado sin prometer acceso cuando el sistema no esté disponible.

#### Scenario: Capacidad todavía sin probar
- **WHEN** el agente está instalado pero no se ha verificado el inicio de sesión remoto de esa combinación de sistema y versión
- **THEN** el equipo aparece como no verificado para acceso completo y la interfaz indica la prueba pendiente

### Requirement: Desactivar y desinstalar
El propietario SHALL poder detener, desactivar y desinstalar el acceso desatendido. Desactivar o desinstalar MUST cortar las sesiones, revocar la credencial del agente y eliminar su arranque automático sin borrar conexiones S3/SSH. La operación MUST explicar qué acceso quedará disponible con el modo de usuario.

#### Scenario: Desinstalar el servicio
- **WHEN** el propietario desinstala el agente con la autorización requerida del sistema
- **THEN** no quedan procesos ni arranque automático del agente, su credencial deja de ser válida y la app conserva sus conexiones
