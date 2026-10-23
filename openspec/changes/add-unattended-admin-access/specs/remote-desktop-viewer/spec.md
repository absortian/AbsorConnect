# Spec Delta

## ADDED Requirements

### Requirement: Acciones administrativas del visor
El visor SHALL ofrecer bloquear, cerrar sesión del sistema y reiniciar solo si el host anuncia esas capacidades. En Windows MUST ofrecer atención segura como acción específica cuando esté admitida. Cerrar sesión y reiniciar MUST pedir confirmación e indicar que pueden interrumpir trabajo. MUST NOT ofrecer ejecución arbitraria de órdenes privilegiadas.

#### Scenario: Reinicio confirmado
- **WHEN** el propietario confirma reiniciar un host compatible
- **THEN** se envía una sola acción autenticada y el visor informa de que espera el arranque, sin anunciar éxito hasta recibir confirmación del host

#### Scenario: Host sin soporte
- **WHEN** el visor se conecta a un host anterior o sin capacidad de reinicio remoto
- **THEN** no ofrece ese comando y no lo simula enviando combinaciones de teclas

### Requirement: Contexto protegido del host
El visor SHALL indicar si el host está en escritorio, bloqueo, entrada, autorización protegida o transición. Mientras no haya imagen actual MUST indicarlo sin presentar el último fotograma como imagen en directo. En contexto protegido MUST deshabilitar portapapeles, ficheros y sonido y liberar teclas y botones pendientes.

#### Scenario: Cambio a UAC
- **WHEN** un host Windows pasa al escritorio seguro durante la sesión
- **THEN** el visor muestra el contexto protegido y su imagen actual o un aviso de transición, sin permitir portapapeles ni transferencias

### Requirement: Reconectar después de reiniciar
Tras un reinicio solicitado, el visor SHALL esperar el regreso del mismo equipo hasta 5 minutos sin crear solicitudes mientras siga fuera de línea. MUST permitir cancelar, exigir prueba nueva de contraseña al volver y explicar el vencimiento del plazo. MUST NOT confundir esta operación con la recuperación de un corte breve de red.

#### Scenario: Equipo disponible otra vez
- **WHEN** el host vuelve a estar en línea dentro del plazo después de reiniciar
- **THEN** el visor solicita autenticación nueva y abre la pantalla de entrada solo si la prueba es correcta

#### Scenario: Equipo no vuelve
- **WHEN** pasan 5 minutos sin que el host vuelva a estar disponible
- **THEN** el visor explica que no pudo comprobar el regreso y permite reintentar sin afirmar que el sistema arrancó

### Requirement: Revocar un equipo desde el controlador
La lista de equipos SHALL permitir al propietario revocar el acceso desatendido de otro equipo de su cuenta tras confirmar el equipo afectado. MUST mostrar el resultado del servicio y no confundir revocación con desconexión de una sesión o borrado de conexiones guardadas.

#### Scenario: Equipo perdido
- **WHEN** el propietario confirma revocar el agente de un equipo
- **THEN** la interfaz refleja la revocación confirmada por el servicio y el equipo necesita una nueva alta para volver a ofrecer acceso desatendido
