# Spec Delta

## Purpose

Define cómo un PC con la app de escritorio se deja controlar en remoto por otros equipos de la misma cuenta: activación, contraseña local, autenticación y bloqueo, qué se comparte, cómo se avisa en el propio PC y en qué sistemas es posible.

## ADDED Requirements

### Requirement: Activar el control remoto de este PC
Ajustes SHALL tener una sección "Control remoto de este PC", desactivada por defecto, con el nombre con el que el PC aparece en la cuenta. Solo MUST poder activarse con una contraseña definida y con la sesión de la cuenta iniciada. Mientras está desactivado, el PC rechaza cualquier conexión.

#### Scenario: Activar sin contraseña
- **WHEN** alguien activa el control remoto sin haber definido la contraseña del PC
- **THEN** Ajustes le pide crearla antes de activarlo

#### Scenario: PC disponible
- **WHEN** alguien activa el control remoto y la app sigue en marcha
- **THEN** el PC aparece como disponible en la lista de equipos de la cuenta en otros equipos

#### Scenario: Propuesta de segundo plano
- **WHEN** alguien activa el control remoto con "Mantener abierta en segundo plano" o "Abrir al iniciar sesión" desactivadas
- **THEN** Ajustes le propone activarlas y le explica que, si la app no está en marcha, el PC no se puede controlar

#### Scenario: Desactivar durante una sesión
- **WHEN** alguien desactiva el control remoto mientras otro equipo controla el PC
- **THEN** la sesión termina al momento y el PC deja de aparecer como disponible

### Requirement: Contraseña local del PC
La contraseña del PC SHALL tener al menos 8 caracteres y confirmarse al escribirla. MUST guardarse solo en ese PC como valor derivado, nunca en claro, y nunca enviarse al servicio ni viajar por la red, tampoco al autenticar. Cambiarla MUST cortar las sesiones activas.

#### Scenario: Contraseña en disco
- **WHEN** se inspecciona la carpeta de datos de la app de un PC con contraseña definida
- **THEN** la contraseña no aparece en claro en ningún fichero

#### Scenario: Nada en el servicio
- **WHEN** se inspeccionan la base de datos del servicio y el tráfico con la API durante el alta y una conexión
- **THEN** no aparece ni la contraseña ni un valor del que pueda comprobarse

#### Scenario: Cambiar la contraseña
- **WHEN** alguien cambia la contraseña del PC mientras otro equipo lo controla
- **THEN** la sesión termina, y la siguiente conexión necesita la contraseña nueva

### Requirement: Autenticación de cada conexión
Cada conexión SHALL demostrar que conoce la contraseña del PC antes de recibir nada. Hasta entonces el PC MUST NOT enviar imagen, sonido, portapapeles ni ficheros, y MUST NOT aplicar ninguna entrada de teclado o ratón.

#### Scenario: Contraseña correcta
- **WHEN** un equipo de la cuenta se conecta con la contraseña correcta
- **THEN** empieza a ver la pantalla y puede manejar el PC

#### Scenario: Contraseña incorrecta
- **WHEN** un equipo se conecta con una contraseña incorrecta
- **THEN** la conexión se cierra sin haber enviado ninguna imagen y el controlador ve "Contraseña incorrecta"

### Requirement: Bloqueo tras intentos fallidos
Tras 5 intentos fallidos seguidos en 15 minutos, el PC SHALL rechazar todas las conexiones durante 15 minutos, indicando al controlador cuánto falta. Un acceso correcto MUST reiniciar la cuenta de fallos.

#### Scenario: Quinto intento fallido
- **WHEN** se falla la contraseña por quinta vez seguida en 15 minutos
- **THEN** cualquier conexión durante los 15 minutos siguientes se rechaza con el tiempo restante, aunque la contraseña sea correcta

### Requirement: Una sesión a la vez
Mientras un equipo controla el PC, el PC SHALL rechazar otras conexiones indicando que está ocupado.

#### Scenario: Segundo controlador
- **WHEN** un equipo intenta conectarse a un PC que ya está controlando otro equipo
- **THEN** recibe el aviso de que el PC está ocupado y la sesión en curso no se ve afectada

### Requirement: Aviso y corte en el PC controlado
Durante una sesión, el PC controlado SHALL mostrar en todo momento un aviso visible encima de las demás ventanas con el nombre del equipo que lo controla y un botón para desconectar. MUST mostrar una notificación del sistema al empezar y al terminar cada sesión.

#### Scenario: Cortar desde el PC
- **WHEN** alguien sentado en el PC controlado pulsa "Desconectar" en el aviso
- **THEN** la sesión termina al momento y el controlador ve que el PC cerró la sesión

### Requirement: Confirmación local opcional
Ajustes SHALL ofrecer "Pedir confirmación en este PC", desactivada por defecto. Con la opción activada, tras la contraseña correcta el PC MUST preguntar a quien esté delante si acepta la conexión, y rechazarla si no responde en 30 segundos o la deniega.

#### Scenario: Sin respuesta
- **WHEN** la opción está activada y nadie responde a la pregunta en 30 segundos
- **THEN** la conexión se rechaza y el controlador ve que el PC no la aceptó

### Requirement: Funciones permitidas
Ajustes SHALL permitir activar o desactivar por separado el portapapeles compartido, el envío y la descarga de ficheros y el sonido, todos activados por defecto. Una función desactivada MUST NOT ofrecerse al controlador y el PC MUST rechazar su uso.

#### Scenario: Ficheros desactivados
- **WHEN** el PC tiene desactivados los ficheros y alguien lo controla
- **THEN** el controlador no ve las opciones de enviar ni descargar ficheros, y el PC no acepta transferencias

### Requirement: Entrada de teclado y ratón
El PC SHALL aplicar el movimiento, los botones, el doble clic, el arrastre y la rueda (vertical y horizontal) del ratón en la posición indicada de la pantalla elegida. MUST aplicar las teclas por su posición física con la distribución del propio PC, y el texto escrito tal cual.

#### Scenario: Distribución del teclado
- **WHEN** el controlador pulsa la tecla situada a la derecha de la L en un teclado español y el PC controlado usa distribución española
- **THEN** en el PC controlado se escribe "ñ"

#### Scenario: Texto desde el móvil
- **WHEN** un móvil envía el texto "¿Año 2026? €"
- **THEN** en el PC controlado aparece exactamente ese texto

#### Scenario: Pantalla con escalado
- **WHEN** el PC controlado tiene una pantalla con escalado al 150 % y el controlador hace clic sobre un botón que ve en la imagen
- **THEN** el clic llega a ese botón

### Requirement: Pantallas del PC
El PC SHALL ofrecer todas sus pantallas al controlador, empezar por la principal y cambiar a la que se elija sin cortar la sesión.

#### Scenario: Cambiar de pantalla
- **WHEN** el controlador elige la segunda pantalla de un PC con dos monitores
- **THEN** pasa a ver esa pantalla, y el ratón y el teclado actúan sobre ella

### Requirement: Ficheros en el PC controlado
Los ficheros recibidos SHALL guardarse en la carpeta "Absor Connect" dentro de Descargas del usuario del PC, sin sobrescribir ficheros existentes. Para la descarga desde el PC, el controlador MUST poder recorrer las carpetas a las que tiene acceso el usuario del sistema que tiene la sesión abierta.

#### Scenario: Nombre repetido
- **WHEN** el controlador envía "informe.pdf" y ya existe un fichero con ese nombre en la carpeta de recepción
- **THEN** el fichero nuevo se guarda con otro nombre y el existente no cambia

### Requirement: Sonido del sistema
Con el sonido permitido, el PC SHALL enviar el sonido del sistema en Windows, en macOS 14.2 o posterior (con el permiso del sistema) y en Linux cuando el servidor de sonido lo permita. Si no puede, el controlador MUST ver que el sonido no está disponible en ese equipo.

#### Scenario: Sonido no disponible
- **WHEN** alguien controla un PC cuyo sistema no permite capturar el sonido
- **THEN** la sesión funciona sin sonido y el controlador ve "Sonido no disponible en este equipo"

### Requirement: Sistemas en los que se puede controlar el PC
El control remoto de este PC SHALL estar disponible en Windows 10 y 11, en macOS y en Linux con sesión X11. En Linux con Wayland, Ajustes MUST mostrar que el sistema no lo permite y no dejar activarlo. Ajustes MUST explicar lo que no se puede controlar: pantalla de bloqueo o de inicio de sesión, avisos de UAC y programas elevados.

#### Scenario: Linux con Wayland
- **WHEN** alguien abre Ajustes en un Linux con sesión Wayland
- **THEN** la sección de control remoto de este PC explica que su sesión no lo permite, sugiere usar una sesión X11, y el interruptor está desactivado

### Requirement: Permisos de macOS
En macOS, Ajustes SHALL mostrar si la app tiene los permisos de Grabación de pantalla y Accesibilidad, con botones que abren el panel correspondiente de Ajustes del Sistema. Mientras falte alguno, el PC MUST aparecer en la cuenta como "faltan permisos" y rechazar las conexiones con ese motivo.

#### Scenario: Permisos perdidos tras actualizar
- **WHEN** tras una actualización macOS ha retirado los permisos de la app y alguien intenta conectarse
- **THEN** el controlador ve que al PC le faltan permisos, y en el PC Ajustes y una notificación indican qué permiso hay que volver a conceder

### Requirement: Mantener el PC despierto
Ajustes SHALL ofrecer "Evitar que el PC se suspenda mientras el control remoto está activado", desactivada por defecto. Con la opción activada, el sistema MUST NOT suspenderse por inactividad mientras la app esté en marcha con el control remoto activado.

#### Scenario: PC sin uso
- **WHEN** la opción está activada y nadie usa el PC durante más tiempo que el configurado para la suspensión
- **THEN** el PC sigue encendido y disponible para el control remoto

### Requirement: Registro de sesiones
El PC SHALL guardar un registro local de los últimos 50 eventos (inicio y fin de cada sesión con el equipo controlador y la duración, intentos fallidos y bloqueos) y mostrarlo en Ajustes. El registro MUST NOT enviarse al servicio.

#### Scenario: Consultar intentos fallidos
- **WHEN** alguien abre el registro después de que otro equipo fallara la contraseña
- **THEN** ve el intento con su fecha, su hora y el nombre del equipo que lo hizo

### Requirement: Control remoto ligado a la cuenta
La configuración del control remoto SHALL pertenecer a la cuenta con la que se activó. Cerrar la sesión MUST dejar el PC sin control remoto, e iniciar sesión con otra cuenta MUST desactivarlo y borrar su contraseña.

#### Scenario: Volver a entrar con la misma cuenta
- **WHEN** alguien cierra la sesión con el control remoto activado y vuelve a entrar con la misma cuenta
- **THEN** el control remoto vuelve a estar activado con la misma contraseña

#### Scenario: Entrar con otra cuenta
- **WHEN** alguien entra en ese PC con una cuenta distinta de la que activó el control remoto
- **THEN** el control remoto aparece desactivado, sin contraseña, y el PC no aparece en la cuenta anterior como disponible
