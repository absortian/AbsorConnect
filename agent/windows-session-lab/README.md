# Supervisor SCM de laboratorio

Componente optativo `windows-session-lab`, sin conexión de red, credenciales,
captura ni entrada. No activa el acceso desatendido de la aplicación.
No se instala en el Mac ni en los equipos físicos.

El servicio LocalSystem de sesión 0 selecciona únicamente la consola devuelta
por WTS. Crea suspendido un trabajador fijo de metadatos en esa sesión, lo
introduce en un Job con un único proceso y `KILL_ON_JOB_CLOSE`, y comprueba de
nuevo consola/época SCM antes de publicarlo. No hereda handles entre sesiones.
El trabajador consulta solamente `Default`/`Winlogon`/no disponible; un nombre
de escritorio no distingue por sí solo UAC, bloqueo e inicio de sesión.

La pipe local usa nombre aleatorio nuevo de 128 bits, primera instancia,
rechazo de clientes remotos y DACL SYSTEM/Administradores. Se comprueban PID,
sesión y token SYSTEM mediante el kernel; el cliente verifica también el PID
actual del servicio SCM. JSON cerrado de 512 bytes, secuencia estricta y reloj
de arranque compartido. No hay RPC de shell, rutas, contraseñas o comandos de red.

Un monitor independiente vigila el progreso del actor. Ambos cortan tras dos
segundos sin pulso válido; la espera inicial tiene cinco segundos. Un fallo del
trabajador tiene tres reintentos con pausas de 250/500/1000 ms. Un cambio de sesión
SCM crea una generación nueva. Los Jobs retiran hijos ante salida/caída del padre.
El trabajador deshabilita sus privilegios y no recibe un handle para matar al
servicio. Su perfil sigue siendo SYSTEM para consultar el escritorio; no es el
trabajador de transporte de red definitivo.

`Stop` persiste `stopped.txt` antes de cerrar hijos y declarar `STOPPED`. Si el
actor está congelado, el monitor observa `STOP_PENDING` y conserva ese estado
antes del corte. Un arranque posterior con ese marcador no crea trabajadores;
solo el argumento SCM administrativo `resume` lo retira. Una instalación,
marcador o ACL inválidos produce salida de configuración, sin recuperación ciega.

Controles SCM administrativos exclusivos del laboratorio:

| Control | Fallo artificial |
|---|---|
| 128 | Congelar el bucle del trabajador |
| 129 | Congelar el bucle del monitor |
| 130 | Congelar el actor del servicio |

Estos controles nunca se anuncian al cliente de AbsorConnect. Los informes
`status.json`, `failure.json`, `worker-failure.json` y `monitor-failure.json`
contienen solo identificadores numéricos, contadores y estados enumerados. Siempre
mantienen `ready_for_unattended`, `capture_tested` e `input_tested` en falso.

## Compilación

Desde la raíz del repositorio:

```bash
cargo +1.85.0 test --manifest-path agent/Cargo.toml -p absor-agent-windows-session
cargo +1.85.0 build --manifest-path agent/Cargo.toml --locked --release -p absor-agent-windows-session --features windows-session-lab
```

CI construye los tres ejecutables Windows con CRT estático y conserva el artefacto
`windows-session-lab-x86_64` durante siete días. Sirve para la VM ARM64 con emulación
x64; no certifica una distribución ARM64 nativa, firma ni actualización de producto.
Los binarios permanecen desactivados fuera de una carpeta de laboratorio protegida,
con marcador de VM y rutas fijas. `install.ps1 -Action Install|Resume|Remove`
solo funciona como SYSTEM en la VM QEMU propia. Rechaza destinos o servicios
existentes, comprueba hashes y propietarios, y verifica por API de Windows la
DACL del servicio, sus cuatro privilegios y la recuperación finita configurada.
El artefacto y sus fuentes se preparan en carpetas protegidas distintas del destino.

La matriz `prototypes/backend-agent-check/windows-session-service-check.py` usa
los accesos privados del laboratorio, conserva informes acotados, ensaya caída,
bloqueo, parada, configuración dañada y reinicio sin usuario, y retira el servicio.
No requiere contraseñas. La sonda de permisos restringe un token del usuario SSH
existente: todavía no certifica una sesión interactiva de usuario estándar.
La aceptación de 4.1 se documentará con la matriz completa, no por compilar.

Pendiente: credenciales/DPAPI y política de intentos, IPC del broker autorizado,
trabajadores de captura/entrada, adaptación DXGI, UAC y transiciones completas,
controladores reales, instalador firmado y piloto físico. Compilar estos binarios
no completa 4.1/4.2/4.4 ni cambia el porcentaje aceptado.
