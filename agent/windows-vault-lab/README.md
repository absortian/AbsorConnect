# Almacén protegido Windows (laboratorio)

`agent-security::windows_vault` implementa el adaptador `AttemptStore` y guarda
el paquete de credenciales mediante DPAPI del perfil SYSTEM, sin
`CRYPTPROTECT_LOCAL_MACHINE` y con `CRYPTPROTECT_UI_FORBIDDEN`. No necesita el
inicio de sesión del propietario ni presenta avisos de credenciales. La entropía
liga cada blob al equipo y a su función: credenciales, intentos, alta o revocación.

El directorio debe existir con propietario SYSTEM y DACL protegida exacta de
SYSTEM/Administradores. Cada apertura comprueba esa DACL por handle, tipo,
tamaño, ausencia de reparse points y un solo enlace para archivos. Los ancestros
permanecen abiertos sin compartir DELETE; no admite UNC, ADS ni componentes de
ruta especiales. Solo hay cuatro nombres de datos y un lock exclusivo de broker.
No existe RPC para elegir rutas, descifrar blobs o reiniciar intentos.

El alta es explícita y exige ausencia de todos los datos previos. `open` nunca
reaprovisiona al faltar un archivo. Los intentos se validan después de descifrar y
antes de escribir. La sustitución usa un archivo nuevo protegido desde su creación,
`FlushFileBuffers` y `MoveFileExW` con `WRITE_THROUGH`. Un archivo `pending.dpapi`
residual bloquea el almacén; no se elimina silenciosamente para recuperar un estado
anterior. El marcador separado de revocación sobrevive a la restauración aislada
del contador y se comprueba antes de conceder acceso.

Esto no protege frente al administrador o SYSTEM malicioso ni frente a restaurar
una copia completa del disco. Tampoco separa aún al broker de un trabajador con
el mismo token SYSTEM: el perfil final del servicio y los named pipes autorizados
siguen pendientes de 4.4. No activa el proveedor de Ajustes ni instala el agente.

## Prueba automática en VM

CI conserva `absor-win-vault-check-lab.exe` con CRT estático en el artefacto
`windows-vault-lab-x86_64`. La matriz de
`prototypes/backend-agent-check/windows-vault-check.py` usa solo la VM propia,
SSH fijado y tareas SYSTEM temporales, sin interfaz. Crea un destino nuevo
protegido, usa credenciales artificiales y K aleatoria, no abre conexiones API,
no captura pantalla ni envía entrada. Conserva únicamente informes enumerados y
retira sus propios archivos al terminar. No requiere iniciar sesión en Windows.

El runner anterior llamaba al agente de UTM y activaba su icono repetidamente en
el Dock. Se ha retirado esa dependencia. `windows_ssh_system.py` usa el acceso SSH
administrativo existente para registrar una tarea sin triggers, con nombre único,
DACL SYSTEM/Administradores y límite de treinta segundos. Comprueba sesión 0 y
SYSTEM, liga el resultado al nonce y retira la tarea y sus archivos. Su journal
privado permite recuperar una solicitud cuyo transporte quede incierto. No es
un RPC del producto y no recibe código de renderers o de la red de AbsorConnect.

La repetición del binario final quedó interrumpida al perder UTM/SSH: falta
comprobar/retirar aquel destino en la VM local. No se debe reabrir UTM desde el
arnés. El modo `--local-ci` verifica también el almacén con SYSTEM real en un
runner Windows hospedado y efímero de GitHub, sin usar el Mac ni sus VM. Exige
ese entorno explícito, fija el nombre del host y no admite reinicio; no acredita
arranque sin usuario ni sustituye el piloto físico.

En `e4e026f03b9e27ba8439c3693c30174cecbff92b` pasan los 21 casos de ese recorrido
en SYSTEM/sesión 0, incluido perder deliberadamente una respuesta y recuperar
su journal sin repetir el efecto. Se retiran las 92 tareas temporales y sus
archivos, además de los datos de la matriz. Se revisan los registros completos
y anotaciones de CI nativo en los tres sistemas. El informe público conserva
por separado este resultado, el reinicio de la primera prueba local y la
limpieza pendiente del último intento local.

El resultado de esta matriz es evidencia parcial de 4.4, no certificación del
agente desatendido, de DPAPI en otras versiones ni de usuarios interactivos.
La retirada/reparación final deberá coordinar la baja API, el servicio y el almacén;
no se deben borrar estos archivos para resolver un error de contraseña.
