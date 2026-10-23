# Viabilidad del host desatendido

Herramientas para las tareas 1.1–1.4 de `add-unattended-admin-access`. Son pruebas
de entorno, no el agente ni una certificación del acceso remoto. Los inventarios
son de solo lectura; las capturas opcionales no guardan ni transmiten imágenes.
No instalan servicios. El ensayo Win32 opcional descrito abajo envía únicamente
Escape al aviso UAC de su propio diagnóstico en la VM QEMU. El ensayo Mac 0.3.0,
todavía pendiente de ejecutar, mueve y restaura el puntero sin clics ni teclas. La preparación UAC
de laboratorio solo aplica cambios o reinicia con opciones explícitas.
No guardar sus resultados con nombres, direcciones o credenciales personales.

## macOS

Requiere Xcode con Swift y macOS 13 o posterior. Compilar en una carpeta nueva
fuera del repositorio evita sustituir un artefacto ya probado:

```bash
bash prototypes/remote-desktop/unattended-check/mac/build.sh /tmp/absor-probe-primera
/tmp/absor-probe-primera/AbsorUnattendedProbe.app/Contents/MacOS/AbsorUnattendedProbe --probe
```

El diagnóstico solo consulta permisos y el contexto del proceso. El identificador
del prototipo es `com.absor.unattended.probe`, distinto de la app instalada; los
permisos de Electron no demuestran permisos del helper.

`build.sh` admite como segundo argumento una identidad de firma existente; por
defecto firma ad-hoc. La firma de desarrollo no acredita distribución Developer ID
ni persistencia de permisos en equipos distintos.

Solo con permiso de grabación ya concedido y en una sesión de prueba autorizada:

```bash
/tmp/absor-probe-primera/AbsorUnattendedProbe.app/Contents/MacOS/AbsorUnattendedProbe --capture
```

Cuenta fotogramas completos durante dos segundos sin guardar/transmitir píxeles,
audio ni títulos de ventanas. Sin permiso sale con código 2 y no lo solicita
automáticamente. Código 3 indica falta de pantalla, fotogramas o error de captura;
64 indica argumentos incorrectos. `--probe` termina con 0 aunque falten permisos:
su éxito solo significa que se ha emitido un diagnóstico válido.

La revisión 0.2.0 emite esquema 2: identifica la fase del fallo y consulta, sin
cambiarla, la disponibilidad gráfica de la sesión de seguridad y de las pantallas.
`--capture-loginwindow` permite hasta tres intentos, con esperas de 3 y 5 segundos,
solo si enumerar el contenido compartible falla con `CGError.invalidContext`
(1003). Otros errores terminan sin repetirse. Los intentos y sus tiempos quedan
en el JSON; una captura correcta sigue contando durante dos segundos. Esto permite
investigar una transición de sesión sin asumir que repetir resuelve la causa.

La revisión 0.3.0, esquema 3, añade `--capture-pointer-loginwindow`, un ensayo que
requiere root antes de completar el login y captura correcta. Vuelve a comprobar
sesión de consola, Accesibilidad y permiso de publicar eventos; si hay un botón
del ratón pulsado, no actúa. Mueve el puntero ocho unidades de coordenadas Quartz
en la pantalla principal, observa la posición y la restaura, con esperas de
300 ms. Registra únicamente si observó movimiento/restauración, sin coordenadas,
imágenes, clics ni teclas. `inputScope: pointer_movement_only` y
`keyboardTested: false` limitan expresamente el resultado. En una sesión de usuario
rechaza ese modo con código 4 antes de capturar o mover el puntero. Un movimiento
correcto tampoco certifica interacción con campos de contraseña o diálogos.

Ni un resultado `capture_ok_not_certified` demuestra entrada, operación como daemon
o acceso a `loginwindow`. Esas pruebas requieren un helper autorizado, la identidad
de distribución y cambios de sesión coordinados para no interrumpir trabajo.

Para comprobar el mismo binario bajo launchd en la sesión gráfica del usuario:

```bash
bash prototypes/remote-desktop/unattended-check/mac/launchd-check.sh \
  /tmp/absor-probe-primera/AbsorUnattendedProbe.app /tmp/absor-launchd-primera
```

Registra temporalmente un trabajo `gui/UID` de una sola ejecución y lo retira al
terminar. No escribe en `~/Library/LaunchAgents` ni instala componentes de sistema.
El informe y stderr quedan en una carpeta privada. La prueba puede revelar que el
permiso de pantalla concedido al ejecutar desde terminal no basta bajo launchd;
no intenta concederlo ni evita TCC. No prueba un daemon ni la pantalla de entrada.

Para preparar una prueba de `LoginWindow`, sin instalarla:

```bash
bash prototypes/remote-desktop/unattended-check/mac/loginwindow-package.sh \
  /tmp/absor-probe-primera/AbsorUnattendedProbe.app /tmp/absor-loginwindow-primera
```

El paquete local sin firma de distribución contiene el mismo bundle firmado y un
LaunchAgent global, limitado exclusivamente al contexto `LoginWindow`. Se ejecuta
una vez por contexto y termina. El paquete 0.2.0 usa `--capture-loginwindow`; el
paquete 0.3.0 preparado usa `--capture-pointer-loginwindow` y añade el movimiento
limitado descrito. No tiene KeepAlive, scripts de instalación, red ni cambios de
la configuración de loginwindow. Un fallo del diagnóstico no es condición para
permitir iniciar sesión.

Instalar requiere la autorización administrativa del propietario; cerrar la sesión
para probarlo también se coordina con él. No instalar durante trabajo sin guardar.
Archivos propios del paquete:

- `/Library/Application Support/AbsorConnectLab/AbsorUnattendedProbe.app`.
- `/Library/LaunchAgents/com.absor.unattended.probe.loginwindow.plist`.
- `/Library/Logs/AbsorConnectLab/`, privado de root, para dos informes sin píxeles.

La versión 0.2.0 escribe `loginwindow-report-v2.json` y
`loginwindow-stderr-v2.txt`; la 0.3.0 usa los sufijos `-v3` y ambas conservan los
informes anteriores. Actualizar el paquete
cambia la firma ad-hoc: los permisos deben volver a verificarse, sin presuponer
que se conservarán. La lectura administrativa de los informes no requiere abrir
sus permisos a otros usuarios.

Recuperación: iniciar sesión normalmente, retirar primero ese plist con permisos
administrativos para impedir futuras ejecuciones y retirar solo el bundle y los
informes propios indicados de las versiones instaladas. El proceso es de una sola ejecución; no hay un
servicio en reinicio continuo que deba pararse. No tocar launch agents de Apple ni
preferencias del sistema. La lista exacta del payload queda junto al paquete.
Olvidar el recibo con `pkgutil --forget com.absor.unattended.probe.loginwindow`
solo retira el recibo; no desinstala los archivos.

Esta prueba no presupone que TCC autorice la captura fuera de la sesión del usuario.
El primer informe de `LoginWindow`, facilitado por el propietario, indicó root,
ambos permisos activos y `capture_error`/`CoreGraphicsErrorDomain` 1003, sin
captura. Tras instalar 0.2.0, renovar sus permisos por la interfaz y cerrar sesión,
el segundo informe recibió once buffers completos en el primer intento, como
root, con acceso gráfico y `loginComplete: false`. No se inspeccionaron píxeles ni
se aplicó entrada. El éxito sin reintentos no identifica la causa del error
anterior; se mantiene pendiente la validación del contenido y del control remoto.

## Mint con X11

Ejecutar como usuario de la sesión gráfica, con Python 3 y libX11:

```bash
python3 prototypes/remote-desktop/unattended-check/linux-probe.py
```

En una conexión SSH se puede indicar el display y la ruta del Xauthority de la
sesión que el usuario esté autorizado a comprobar:

```bash
python3 prototypes/remote-desktop/unattended-check/linux-probe.py --display :0 --authority "$HOME/.Xauthority"
```

Solo consulta logind, el gestor de entrada y la disponibilidad de la extensión
XTEST. No imprime el contenido de Xauthority ni modifica el control de acceso.
Poder abrir el display del usuario no demuestra acceso al greeter LightDM.

`--capture` cuenta durante dos segundos imágenes de una región central de
128 × 72 píxeles usando XGetImage. Solo publica el recuento y cuántas muestras no
eran uniformes; no publica píxeles ni hashes de contenido. No demuestra captura
de toda la pantalla, entrada, polkit ni transiciones LightDM/Cinnamon.

`--pointer` añade un ensayo explícito de XTest limitado al usuario de la sesión
X11 activa y desbloqueada, con UID/display coincidentes con logind. Si un botón
está pulsado, no mueve nada. Desplaza el puntero ocho píxeles y comprueba su
restauración, sin clics, teclas ni coordenadas en el informe. El resultado sigue
sin acreditar bloqueo, polkit ni LightDM. Puede combinarse con `--capture`.

## Windows

En el equipo de pruebas, desde PowerShell:

```powershell
& .\prototypes\remote-desktop\unattended-check\windows-probe.ps1
```

Consulta versión, arquitectura, contexto de privilegios, política UAC y estado de
protección del volumen si tiene permiso. No cambia la política de ejecución; si
el sistema impide ejecutar el script, utilizar el procedimiento autorizado del
equipo. Este inventario no prueba captura de UAC, entrada ni atención segura.

`windows/CaptureProbe.cs` añade un diagnóstico Win32 mediante P/Invoke, compilado
con el compilador incluido en PowerShell/.NET. El lanzador requiere SYSTEM y
duplica su propio token para crear un trabajador de este mismo binario en la
sesión de consola; no recibe órdenes de red, rutas de programa ni RPC.
El trabajador de captura abre el escritorio de entrada, cuenta capturas GDI durante dos
segundos a 320 × 180 y termina. No crea ventanas, no cambia el escritorio visible,
no guarda imágenes, no aplica entrada y no instala un servicio SCM.

`run-probe.ps1 -TestUacInput` añade un ensayo explícito y exclusivo de la VM QEMU,
con SYSTEM, UAC activo, escritorio seguro y política de consentimiento esperada.
La carpeta de prueba permite lectura/ejecución al usuario filtrado, con escritura
solo para SYSTEM/Administradores. Primero captura `Default`; después lanza el
propio diagnóstico con el token filtrado del usuario, que solicita elevar solo ese
mismo binario. Al aparecer `Winlogon`, captura ese escritorio y crea otro trabajador
SYSTEM directamente en `winsta0\winlogon`, con el mismo ejecutable y modo fijo.
Este comprueba que `consent.exe` está en primer plano y envía exclusivamente
Escape, pulsación y liberación, mediante `SendInput`. No recibe teclas, rutas ni
órdenes de una conexión externa. Los modos internos de entrada requieren SYSTEM
en una sesión interactiva y la política del laboratorio QEMU.

El ensayo espera de forma acotada a que aparezca la ventana de consentimiento y
exige dos eventos insertados, salida 1223 del solicitante y regreso a `Default`
antes de informar éxito. Un fallo retira el solicitante propio, espera su salida y
registra si observó la vuelta a `Default`; no presupone que terminar ese proceso
cambie el escritorio inmediatamente. No acepta UAC, instala servicios ni cambia
políticas. Los archivos
`uac-input-report.json`, `uac-input-capture.json` y `escape-report.json` son informes
de metadatos creados sin sobrescribir archivos anteriores. Una primera variante
que cambiaba solo el escritorio de un hilo capturó pero no pudo insertar entrada;
la variante con proceso creado en el escritorio seguro sí canceló el aviso.
Esto no acredita ratón, escritura de credenciales, atención segura ni login.

Para reproducir, copiar `CaptureProbe.cs` y `run-probe.ps1` a una carpeta nueva
de laboratorio con propietario SYSTEM/Administradores, DACL protegida y escritura
exclusiva de esas identidades. Desde un contexto SYSTEM autorizado de la VM,
ejecutar `run-probe.ps1`. El script rechaza una carpeta compartida, enlaces,
archivos de salida existentes y escritores no autorizados; devuelve hashes de
fuente/binario y el resultado. Si la política de PowerShell impide ejecutar un
archivo, puede ejecutarse el contenido revisado como comando explícito con
`-WorkingDirectory` apuntando a esa carpeta. No se usa `-ExecutionPolicy`, no se
modifica la política ni se eluden comprobaciones del compilador.

En este laboratorio se usó la API de ejecución del agente de invitado de UTM,
ya instalado en la VM. Su CLI tiene el [fallo de espera #7932](https://github.com/utmapp/UTM/issues/7932):
una salida vacía con código 0 no demuestra ejecución correcta. La herramienta
local de laboratorio consulta `exited`, espera como máximo 60 segundos y valida
salida y código reales; no proporciona automatización de teclado/pantalla.
No se usa ese agente de UTM como parte del producto AbsorConnect.

`windows/prepare-uac-lab.ps1` solo consulta por defecto. Rechaza equipos que no
sean VM QEMU y políticas inesperadas. Tras coordinarlo con el propietario,
`-Apply` activa EnableLUA; nunca lo desactiva ni modifica el escritorio seguro.
`-Restart`, junto con `-Apply`, solicita reinicio normal sin forzar aplicaciones.
Esta preparación corrige una precondición del laboratorio, no un permiso del
agente. Hay que verificar de nuevo UAC tras arrancar, antes de probar elevación.

Para comprobar la transición al escritorio seguro, `--launch-uac-probe` requiere
SYSTEM y lanza el mismo binario con el token del usuario de consola. Ese proceso
rechaza un contexto ya elevado y solicita `runas` exclusivamente para
`--elevated-self-check` del propio diagnóstico. Si se autorizase manualmente,
solo comprobaría que tiene contexto de administrador y terminaría sin cambios.
En las pruebas realizadas se canceló con Escape mediante UTM, sin conceder la
elevación. La cancelación devuelve 1223. El lanzador limita la espera a 180
segundos y, si vence, termina únicamente su propio solicitante; no pulsa botones.
El primer intento con espera de 45 segundos venció y se registró como fallo.

Este modo requiere que los usuarios puedan leer/ejecutar su binario, conservando
la escritura exclusiva de SYSTEM/Administradores. No copiar secretos a esa
carpeta. El capturador SYSTEM y la solicitud de elevación se ejecutan por
procesos independientes: esperar al solicitante antes de capturar devuelve al
escritorio normal y no prueba UAC. Un informe `Default` no debe contarse como
captura del escritorio seguro; incluso `Winlogon` más fotogramas no uniformes no
certifica el contenido exacto del diálogo ni la entrada Win32.

## Criterio de avance

Conservar las tareas sin marcar hasta completar todos sus escenarios reales.
Registrar por separado los casos comprobados y los pendientes en el cambio
OpenSpec. No publicar «acceso completo» ni activar el servicio a partir de estos
diagnósticos de entorno.


### Cierre de sesión de la VM de laboratorio

`windows/SessionProbe.cs` es un ejecutable separado, sin red ni servicio,
que requiere QEMU y SYSTEM en sesión 0. `--status` consulta si hay un usuario
en consola, sin imprimir su nombre. `--logout-qemu-lab` solicita cerrar esa
sesión y espera hasta quince segundos a observar que ya no tiene usuario.
**Cierra las aplicaciones de esa sesión de la VM:** usar únicamente en el
laboratorio autorizado y con el trabajo guardado. No cambia autologin, UAC,
contraseñas o la configuración de inicio de sesión. No sirve para desbloquear.
Compilar con `Add-Type -Path ... -OutputType ConsoleApplication -OutputAssembly ...`
en una carpeta nueva protegida como la del capturador; verificar su hash antes
de ejecutarlo. El capturador se lanza después desde sesión 0 en su propio
contexto; no se usa una imagen de `Default` como evidencia de prelogin.

Las APIs utilizadas son [WTSLogoffSession](https://learn.microsoft.com/en-us/windows/win32/api/wtsapi32/nf-wtsapi32-wtslogoffsession)
y [WTSQuerySessionInformation](https://learn.microsoft.com/en-us/windows/win32/api/wtsapi32/nf-wtsapi32-wtsquerysessioninformationw).
