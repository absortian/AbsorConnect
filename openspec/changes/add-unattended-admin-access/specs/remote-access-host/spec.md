# Spec Delta

## MODIFIED Requirements

### Requirement: Activar el control remoto de este PC
Ajustes SHALL tener una sección "Control remoto de este PC", desactivada por defecto, con el nombre del PC. Solo MUST poder activarse con contraseña definida y cuenta iniciada. Mientras esté desactivado, el PC rechaza conexiones. El modo de usuario requiere la app abierta; el desatendido requiere instalación y alta autorizadas del agente. Ajustes MUST explicar ambos modos.

#### Scenario: Activar sin contraseña
- **WHEN** alguien activa el control remoto sin haber definido la contraseña del PC
- **THEN** Ajustes le pide crearla antes de activarlo

#### Scenario: PC disponible
- **WHEN** alguien activa el control remoto y la app sigue en marcha
- **THEN** el PC aparece como disponible en la lista de equipos de la cuenta en otros equipos

#### Scenario: Propuesta de segundo plano
- **WHEN** alguien activa el control remoto con "Mantener abierta en segundo plano" o "Abrir al iniciar sesión" desactivadas
- **THEN** en el modo de usuario Ajustes propone activarlas y explica que, sin la app abierta, ese modo no está disponible

#### Scenario: Desactivar durante una sesión
- **WHEN** alguien desactiva el control remoto mientras otro equipo controla el PC
- **THEN** la sesión termina al momento y el PC deja de aparecer como disponible

#### Scenario: Segundo plano con agente
- **WHEN** se activa el servicio desatendido y la interfaz no está configurada para abrir al iniciar sesión
- **THEN** se explica que el agente arranca con el sistema y que el inicio de la interfaz es independiente


### Requirement: Aviso y corte en el PC controlado
Durante una sesión, el escritorio de usuario SHALL mostrar un aviso visible con el controlador y un botón para desconectar, además de notificaciones de inicio y fin. En pantallas protegidas MUST usarse solo avisos admitidos por el sistema; al volver al escritorio se restaura el aviso. El registro local MUST conservar el inicio y fin aunque no pueda mostrarse una notificación.

#### Scenario: Cortar desde el PC
- **WHEN** alguien sentado en el PC controlado pulsa "Desconectar" en el aviso
- **THEN** la sesión termina al momento y el controlador ve que el PC cerró la sesión

#### Scenario: Pantalla protegida
- **WHEN** una sesión autenticada pasa al escritorio seguro de UAC o a la pantalla de entrada
- **THEN** no se insertan ventanas ajenas en el diálogo del sistema; el controlador ve el contexto protegido y el aviso local se restaura al volver al escritorio


### Requirement: Funciones permitidas
Ajustes SHALL permitir activar o desactivar por separado portapapeles, ficheros y sonido, activados por defecto en el escritorio de usuario. Una función desactivada MUST NOT ofrecerse ni aceptarse. En bloqueo, entrada y escritorio seguro MUST suspenderse las tres funciones, descartar operaciones pendientes y datos compartidos del contexto anterior, y restaurar solo las permitidas al volver a un escritorio autenticado.

#### Scenario: Ficheros desactivados
- **WHEN** el PC tiene desactivados los ficheros y alguien lo controla
- **THEN** el controlador no ve las opciones de enviar ni descargar ficheros, y el PC no acepta transferencias

#### Scenario: Credenciales del sistema
- **WHEN** aparece una pantalla de bloqueo, entrada o escritorio seguro
- **THEN** se cancelan transferencias y sincronización pendientes, no se comparte el portapapeles y no se emite sonido; la entrada remota sigue exigiendo autenticación de la conexión


### Requirement: Ficheros en el PC controlado
Los ficheros recibidos SHALL guardarse en "Absor Connect" dentro de Descargas del usuario de la sesión, sin sobrescribir existentes. La descarga MUST limitarse a los directorios accesibles por ese usuario. El agente privilegiado MUST NOT ampliar ese acceso. Sin una sesión de usuario apropiada o en pantalla protegida, las transferencias MUST estar deshabilitadas.

#### Scenario: Nombre repetido
- **WHEN** el controlador envía "informe.pdf" y ya existe un fichero con ese nombre en la carpeta de recepción
- **THEN** el fichero nuevo se guarda con otro nombre y el existente no cambia

#### Scenario: Sin usuario conectado
- **WHEN** el agente muestra la pantalla de entrada sin sesión de usuario
- **THEN** no ofrece Descargas de root/SYSTEM ni permite explorar sus ficheros


### Requirement: Sistemas en los que se puede controlar el PC
El modo de usuario SHALL seguir disponible en Windows 10/11, macOS y Linux X11 con sus límites actuales. El modo desatendido MUST habilitar administración, bloqueo e inicio de sesión solo en configuraciones certificadas de Windows, macOS y Mint Cinnamon/X11/LightDM. Ajustes MUST mostrar los límites reales de cada modo. Wayland sigue sin admitir el equipo como host.

#### Scenario: Linux con Wayland
- **WHEN** alguien abre Ajustes en un Linux con sesión Wayland
- **THEN** la sección de control remoto de este PC explica que su sesión no lo permite, sugiere usar una sesión X11, y el interruptor está desactivado

#### Scenario: Modo de usuario sin servicio
- **WHEN** se actualiza una instalación sin agente desatendido
- **THEN** mantiene su control remoto actual y sigue explicando los límites de UAC, aplicaciones elevadas, bloqueo e inicio de sesión


### Requirement: Control remoto ligado a la cuenta
La configuración remota SHALL pertenecer a la cuenta que la activó. Cerrar la cuenta de AbsorConnect MUST cortar todo acceso, incluido el agente, y revocar su credencial; iniciar otra cuenta MUST desactivarlo y borrar la contraseña anterior. El modo de usuario conserva su reactivación previa al volver a la misma cuenta; el desatendido requiere alta nueva. Cerrar sesión del sistema operativo MUST NOT revocar el agente.

#### Scenario: Volver a entrar con la misma cuenta
- **WHEN** alguien cierra la sesión con el control remoto activado y vuelve a entrar con la misma cuenta
- **THEN** en el modo de usuario el control remoto vuelve a estar activado con la misma contraseña

#### Scenario: Entrar con otra cuenta
- **WHEN** alguien entra en ese PC con una cuenta distinta de la que activó el control remoto
- **THEN** el control remoto aparece desactivado, sin contraseña, y el PC no aparece en la cuenta anterior como disponible

#### Scenario: Volver con servicio revocado
- **WHEN** el propietario vuelve a iniciar sesión en AbsorConnect después de revocar el agente al salir de la cuenta
- **THEN** el modo desatendido sigue desactivado hasta que autorice una nueva alta, aunque pueda reutilizar la configuración local de su misma cuenta
