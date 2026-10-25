# Viabilidad del host desatendido

Herramientas para las tareas 1.1–1.4 de `add-unattended-admin-access`. Son pruebas
de entorno, no el agente ni una certificación del acceso remoto. Los inventarios
son de solo lectura; las capturas opcionales no guardan ni transmiten imágenes.
No instalan servicios. El ensayo Win32 opcional descrito abajo envía únicamente
Escape al aviso UAC de su propio diagnóstico en la VM QEMU. El ensayo Mac 0.7.0
intenta mover y restaurar el puntero sin clics ni teclas. La preparación UAC
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

La revisión 0.4.0, esquema 4, conserva ese alcance y añade checkpoints JSON en
stderr antes de consultar permisos, sesión, contexto gráfico, captura y puntero.
Un temporizador independiente limita la ejecución a 30 segundos: emite
`diagnostic_timeout`, `lastStage` y `completionUnverified: true`, y termina con
código 70. Un timeout no demuestra que no hubo captura o movimiento parcial;
puede interrumpir la restauración del puntero. Tampoco diagnostica un bloqueo
del cargador anterior a la entrada en Swift. Dos archivos vacíos siguen siendo
un resultado inconcluyente, no una prueba de entrada ni una causa identificada.

La revisión 0.5.0, esquema 5, separa las fases de lectura de posición, límites de
pantalla, creación de fuente y construcción de cada evento. Usa una fuente
`CGEventSource.privateState` con las mismas comprobaciones y el mismo tap; no
llama a APIs privadas ni cambia TCC. El temporizador conserva el resultado de
captura ya completado antes de probar entrada, pero mantiene
`inputTested: false` y `completionUnverified: true` si la ejecución no termina.
Esto permite distinguir un bloqueo posterior de una captura no ejecutada.

La revisión 0.6.0, esquema 6, prueba la fuente predeterminada (`nil`), admitida
por `CGEventCreateMouseEvent`, en lugar de crear una fuente explícita. Conserva
los checkpoints, permisos, guardas de sesión y alcance de ocho píxeles;
`pointer.eventSource: default` identifica esta variante en el resultado.

La revisión 0.7.0, esquema 7, aísla el movimiento mediante la API pública
`CGWarpMouseCursorPosition`, con las mismas guardas, distancia y restauración.
Registra el resultado de ambas llamadas y `pointerStrategy: public_cursor_warp`.
[Apple documenta que esta API no genera ni publica eventos](https://developer.apple.com/documentation/coregraphics/cgwarpmousecursorposition(_:)):
un desplazamiento observado no prueba que una aplicación reciba clics o teclado.

`--watchdog-self-test` no consulta permisos ni captura: espera a que el
temporizador de un segundo termine el proceso con código 70. Sirve para
comprobar este límite antes de instalar el paquete en un laboratorio.

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
una vez por contexto y termina. El paquete 0.2.0 usa `--capture-loginwindow`; los
paquetes 0.3.0–0.7.0 usan `--capture-pointer-loginwindow` y añaden el movimiento
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
`loginwindow-stderr-v2.txt`; las versiones 0.3.0–0.7.0 usan los sufijos `-v3`–`-v7`. Conservan los
informes anteriores. launchd puede añadir varias ejecuciones al mismo archivo:
leer cada objeto JSON y seleccionar la ejecución nueva, comprobando la fecha del
informe contra `kern.boottime`; no interpretar el primer objeto como el arranque
recién probado. Actualizar el paquete
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

En la VM macOS 27.0.1 arm64, 0.4.0 se bloqueó al construir el evento y 0.5.0 no
pudo crear su fuente privada. 0.6.0 capturó once fotogramas y publicó los eventos
sin bloqueo, tanto tras logout como tras reiniciar, pero no observó el
desplazamiento. La entrada no está validada; la tarea 1.3 permanece abierta y
requiere revisión antes del agente final. 0.7.0 observó movimiento y restauración
tras logout y tras un arranque nuevo, además de once fotogramas, sin clics ni
teclas. No se certifica entrada de credenciales ni el Mac físico. Las evidencias y los límites figuran
en `openspec/changes/add-unattended-admin-access/verification.md`.

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

### Mint: recepción en una ventana propia

`linux-owned-input-check.py --test-own-input` crea una ventana GTK 3 propia del
usuario de Cinnamon/X11 y comprueba un clic y una pulsación fija, con sus
liberaciones. Requiere Python 3, PyGObject/Gtk/GdkX11, libX11 y libXtst ya
instalados, `:0` y el `.Xauthority` privado del usuario. Rechaza root y no admite
otros destinos ni teclas. Caduca a los veinte segundos y no tiene campos de texto.

Antes de enviar comprueba la sesión activa y desbloqueada, el estado de Cinnamon,
ausencia de entrada retenida y foco en la ventana propia o uno de sus hijos GTK.
Para el clic comprueba también posición y jerarquía bajo el puntero, evitando
ventanas superpuestas. Cuenta callbacks nativos de GTK, sin equiparar el retorno
de XTest a recepción. Difiere cancelaciones durante cada par down/up y restaura
el puntero si continúa siendo suyo; no lo disputa si interviene el usuario.
Destruye su ventana y observa si el gestor devuelve el foco anterior.

Dos ejecuciones de la revisión final en Mint x86_64 recibieron un mouse-down/up y
un key-down/up, sin eventos inesperados, con puntero y foco previo restaurados.
La primera revisión se canceló al comparar solo el XID principal: GTK enfocaba
un hijo InputOnly propio. La revisión final verifica ese árbol propio y mantiene
el rechazo de ventanas ajenas. Evidencia: `mint-owned-input-results.json`.
No demuestra entrada en otro proceso, como root, en bloqueo o en LightDM/polkit.

Las APIs usadas se documentan en [Gtk.DrawingArea](https://docs.gtk.org/gtk3/class.DrawingArea.html),
[GdkX11.get_xid](https://docs.gtk.org/gdk3-x11/method.X11Window.get_xid.html) y el
[manual de XTest](https://xorg.freedesktop.org/archive/X11R7.5/doc/man/man3/XTestFakeKeyEvent.3.html).

### Mint: solicitud manual de polkit

`linux-polkit-manual-check.py --request-polkit` debe ejecutarse desde Terminal
del escritorio Mint, como usuario normal, en una carpeta nueva privada (0700).
Copiar allí también `linux-probe.py` y `linux-owned-input-check.py`, con permisos
0600; el solicitante fija sus hashes antes de importar/ejecutar esos diagnósticos.
Los archivos de eventos y resultado se crean exclusivamente, sin sobrescrituras.

El único destino es `pkexec --disable-internal-agent /usr/bin/true`, con ambos
ejecutables pertenecientes al sistema y sin permisos de escritura para otros.
La contraseña se introduce manualmente en el agente gráfico de polkit. El script
no recibe credenciales ni envía entrada. Mientras la solicitud sigue pendiente,
cuenta dos segundos de imágenes de una región; no las conserva. Cuando publica
`CAPTURA_COMPLETADA`, el propietario puede autenticar o cancelar el aviso. Espera
hasta dos minutos y retira su solicitante si vence el plazo o se interrumpe.

Una salida cero de `pkexec` registra que terminó la operación fija. La presencia
del diálogo y el uso de contraseña requieren confirmación del propietario;
el script no certifica por sí solo autenticación manual ni entrada remota.
El informe bruto conserva `polkitTested:false`. La prueba manual del 25/10 queda
reconciliada en `mint-polkit-manual-results.json`: diez muestras durante la
solicitud, ejecución fija terminada a cero y autenticación con contraseña
confirmada por el propietario. Se observó `-i` minúscula en la invocación real y
se pidió salir del intérprete interactivo; no acredita aislamiento `-I`.
Los significados
de los códigos y la desactivación del agente de texto siguen el
[manual oficial de pkexec](https://www.freedesktop.org/software/polkit/docs/latest/pkexec.1.html).

### Mint: emisor root hacia un receptor de usuario, pendiente de ensayo

`linux-root-input-check.py --test-root-owned-input` exige fuentes protegidas de
root y el auxiliar `linux-session-check.py` con su hash fijado. Resuelve la
autoridad privada de Xorg para `:0`, sin copiar cookies ni cambiar permisos.
El receptor es un proceso GTK separado del usuario activo, sin grupos adicionales.
El emisor solo acepta la ventana de ese PID, con foco en su árbol propio y sin
entrada retenida. Comprueba también sesión/Cinnamon y jerarquía bajo el puntero.
Envía únicamente un clic y una tecla fija con sus liberaciones; compara los
contadores nativos del receptor, restaura el puntero y retira el trabajador.
No tiene servicio ni canal remoto; el socketpair heredado solo intercambia
preparación, final y contadores. El límite del emisor es treinta segundos.

El propietario ejecuta `linux-root-input-install.sh` como usuario desde una
carpeta privada nueva, junto con esas dos fuentes. El lanzador comprueba hashes,
usa sudo para copiarlas como root/0600 a un destino nuevo de laboratorio y
vuelve a verificar sus hashes antes del ensayo. No sobrescribe una instalación
o informe anterior, crea servicios ni cambia políticas. Python usa `-I` dentro
del lanzador para evitar la confusión entre las letras al escribir el comando.

Solo están comprobadas sintaxis y denegaciones sin root, con fuentes no protegidas,
sin herramientas de sesión y con argumentos ajenos al lanzador. La ejecución
real root → usuario está **pendiente**. Aun si pasa, será una ventana propia de
laboratorio: no certificará entrada en greeter, bloqueo o polkit ni el agente.
La retirada de UID/grupos y el paso exclusivo del descriptor siguen
[Popen de Python](https://docs.python.org/3.12/library/subprocess.html#subprocess.Popen).
La lectura de la propiedad PID respeta el formato y almacenamiento documentados
por [XGetWindowProperty](https://xorg.freedesktop.org/archive/X11R7.5/doc/man/man3/XGetWindowProperty.3.html).

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

### Windows: recepción de entrada en una ventana propia

`run-probe.ps1 -TestOwnedInput` añade dos ejecuciones acotadas del mismo binario:
una con el token filtrado del usuario de consola y otra con SYSTEM. Cada trabajador
crea una ventana Win32 propia en `Default` y solo envía un clic y un carácter
Unicode fijo cuando esa ventana conserva el primer plano, el foco y la sesión de
consola, sin botones ni teclas previamente pulsados. Comprueba también que el punto
de clic pertenece a esa ventana. No acepta destinos ni texto como argumentos.

El código cero exige observar en su procedimiento de ventana la pulsación y
liberación del ratón, las del teclado y el carácter esperado; no basta con que
`SendInput` acepte eventos. Restaura el puntero si sigue en la posición de prueba
y conserva el foco; una intervención local cancela la prueba en vez de competir
con ella. La ventana se retira al terminar. Fuera del token/sesión esperados se
rechaza antes de crearla o enviar entrada.

Reproducir desde SYSTEM autorizado en una carpeta nueva protegida como la descrita
arriba, con lectura/ejecución al usuario filtrado. El script compila, cuenta primero
capturas de `Default` y recoge ambos resultados. Los indicadores de recepción
derivan del código cero posterior a las aserciones nativas; no se almacenan teclas,
imágenes ni trazas de eventos. Este ensayo se ejecutó mediante el acceso SSH de
laboratorio autorizado y tareas temporales sin disparador automático, retiradas
al terminar. No depende del RPC de UTM ni instala un servicio del producto.

El destino pertenece al mismo proceso que inyecta la entrada. Esto demuestra
recepción con ambos tokens, pero **no control entre procesos ni de otra aplicación
elevada**. Tampoco prueba credenciales, bloqueo/login, códigos físicos de teclado,
varios monitores, escalados o transporte remoto. La evidencia está en
`openspec/changes/add-unattended-admin-access/windows-owned-input-results.json`;
la tarea 1.2 permanece parcial.

### Windows: entrada en un receptor elevado de otro proceso

`run-probe.ps1 -TestElevatedInput` añade un emisor SYSTEM interactivo y otro
proceso receptor del diagnóstico, con el token completo del usuario de consola.
Solo se admite en la VM QEMU y con las políticas UAC esperadas. SYSTEM ya
administrativamente autorizado obtiene el token vinculado y crea **solo este
receptor fijo**. Este ensayo no solicita consentimiento UAC ni acredita ese paso.
No acepta ruta, texto, PID o coordenadas de un tercero.

Ambos lados comprueban token completo e integridad alta del receptor; el emisor
contrasta su identidad con la del usuario de consola y conserva el handle real
del hijo. Antes de mover, pulsar o escribir, comprueba escritorio, PID/hilo,
primer plano, foco de ese hilo y ausencia de teclas retenidas. El receptor no
inyecta entrada: cuenta mouse down/up, key down/up y el carácter fijo recibido.
El runner cruza los PIDs y la sesión de los dos informes y exige los cinco
contadores a uno, salida cero y restauración del puntero. Se puede combinar con
`-TestOwnedInput` para volver a comprobar las dos ventanas del mismo proceso.

Reproducir desde SYSTEM en una carpeta nueva y protegida como los otros ensayos.
El hijo tiene plazo propio y el emisor retira solo su proceso si falla; no quedan
tareas automáticas ni un servicio instalado. Los JSON contienen metadatos y
contadores, sin imágenes, contraseñas ni trazas de teclado. Evidencia saneada en
`openspec/changes/add-unattended-admin-access/windows-elevated-input-results.json`.
No certifica una herramienta comercial, credenciales, bloqueo/login ni transporte.

Referencias de las APIs usadas: [GetGUIThreadInfo](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getguithreadinfo),
[TOKEN_LINKED_TOKEN](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-token_linked_token)
y [SendInput/UIPI](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput).

### Windows: credenciales manuales y Escape en bloqueo

La evidencia `windows-credential-uac-results.json` documenta un `runas` del
propio diagnóstico desde una cuenta local estándar. El propietario introduce
las credenciales de administrador en UAC; el destino solo comprueba pertenencia
al contexto de administrador y termina. El informe bruto confirma código cero,
la captura obtiene ocho fotogramas de `Winlogon` mientras el aviso está visible
y nueve de `Default` después. **No es entrada de credenciales por AbsorConnect.**

`run-probe.ps1 -TestLockEscape` es un ensayo exclusivo para la VM QEMU bloqueada.
Debe coordinarse con el propietario, que conserva su contraseña para desbloquear.
Preparar el formulario de contraseña vacío mediante la consola de la VM y
lanzar el runner desde SYSTEM en una carpeta nueva protegida. Este compila,
cuenta capturas de `Winlogon` y crea un trabajador SYSTEM en ese escritorio.
Solo permite Escape si el primer plano pertenece a `System32/LogonUI.exe`, la
sesión es la consola activa y no hay teclas previamente pulsadas. No acepta texto,
coordenadas ni otro ejecutable, y no introduce ni envía credenciales.

El informe distingue **eventos insertados de recepción verificada**:
`lockEscapeReceptionRequiresVisualObservation` exige observar el efecto desde
la consola. En el ensayo del 25/10 la captura bloqueada dio nueve fotogramas,
pero Escape no produjo cambio inmediato verificable, tampoco en una comparación
por consola. Un fondo de bloqueo observado más tarde no se atribuye al evento.
Por ello la recepción queda **inconclusa**, aun con código cero y dos eventos.
Evidencia: `windows-lock-escape-results.json`; no certifica el inicio de sesión.

Los nuevos modos se rechazan desde SSH sin SYSTEM en sesión 0. Una regresión
con `-TestOwnedInput -TestUacInput` verifica las ventanas propias y la cancelación
UAC anterior, con retorno 1223. El runner no combina ese ensayo con el de bloqueo.
Los informes originales son privados y solo contienen metadatos/contadores.

### Windows: recepción de navegación de foco en LogonUI

El desbloqueo manual posterior al ensayo Escape recuperó ocho fotogramas no
uniformes en `Default`. Eso completa su comprobación de recuperación; la recepción
de Escape sigue inconclusa.

`-TestFocusSelf` comprueba primero Tab y Mayús+Tab en una ventana propia del
usuario estándar. Contiene un campo vacío, de contraseña y solo lectura, y un
botón sin acción. La ventana usa su propio hilo STA; el cliente de UI Automation
se ejecuta en otro hilo MTA. El trabajador solo devuelve cero si observa que el
foco cambia y vuelve a la identidad del control original.

`-TestLogonFocus` es exclusivo y requiere la VM bloqueada, con el formulario de
contraseña vacío preparado por su consola. Captura `Winlogon` y ejecuta el mismo
recorrido desde SYSTEM en ese escritorio. Antes de cada envío comprueba sesión
de consola, escritorio, primer plano de `System32/LogonUI.exe`, foco esperado y
ausencia de teclas retenidas. Solo envía Tab y Mayús+Tab: seis eventos en total.
UI Automation consulta PID, tipo de control, `IsPassword` e identidad opaca para
compararla en memoria. No lee `Name`, `Value` ni texto, y no registra identidades
de controles. No envía Enter, clics ni credenciales.

En Windows ARM64 se verificó cambio de foco de campo de contraseña a botón y
vuelta al campo original, con nueve capturas no uniformes de `Winlogon`. La
regresión también pasa las ventanas propias y la cancelación UAC con 1223.
Tras desbloquear manualmente se recuperaron nueve capturas de `Default`.
Evidencia: `windows-logon-focus-results.json`. Esta prueba confirma esas teclas
de navegación en bloqueo y recuperación; no certifica autenticación remota, SAS
ni el agente.

El compilador usa las bibliotecas UI Automation de .NET ya presentes en Windows,
sin instalar paquetes. Se sigue la documentación de Microsoft para separar el
[cliente UIA de su propia interfaz](https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.automationelement.focusedelement)
y tratar los [runtime IDs como valores opacos de comparación](https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.automationelement.getruntimeid).

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

### Mac 0.9.0: ventana propia para comprobar eventos (histórico)

El paquete 0.9.0 preparaba `--capture-owned-input-loginwindow`. Conserva los modos
anteriores y añade un ensayo exclusivo de VirtualMac, root y LoginWindow. Tras
capturar y mover/restaurar ocho píxeles, muestra una ventana propia; solo publica
un clic y Escape cuando esa misma ventana y proceso tienen el foco, sin teclas
previamente pulsadas y con ambos permisos de entrada. Cuenta la entrega en su
propia vista y restaura el puntero. No introduce texto ni actúa sobre la ventana
de entrada del sistema. Un foco no verificable cancela el ensayo.

El payload sigue teniendo cuatro archivos y ningún script de instalación. Los
informes usan `loginwindow-report-v9.json` y `loginwindow-stderr-v9.txt`. El modo
no acredita credenciales, autorización de macOS ni el Mac físico aunque llegue a
recibir sus eventos. La compilación, paquete y actualización en VM están
verificados; la firma nueva requirió retirar y añadir el bundle instalado en
los dos paneles de Ajustes de la VM. No renovar permisos mediante TCC ni presumir
que sobrevivieron a la actualización.

La versión 0.8.0 agotaba los 30 segundos dentro de `NSApplication.runModal`:
el trabajo pendiente de `DispatchQueue.main` no se ejecutaba desde ese contexto
`main() async`. Se reprodujo en una ventana aislada sin captura ni entrada.
0.9.0 usa temporizadores de `RunLoop.main` en modo `.modalPanel`, invalida los
pendientes al salir y registra las fases del ensayo. El watchdog independiente
sigue limitando los bloqueos dentro del SDK.

El 24/10/2026, bajo launchd gráfico recibió seis fotogramas en 2481 ms. Tras
logout y arranque limpio recibió once en 2440/2681 ms, con UID 0, consola,
`loginComplete:false` y ambos permisos. El puntero se movió y restauró. En ambos
casos **canceló antes de crear/publicar clics o teclas** porque no pudo confirmar
el conjunto de condiciones de foco (`owned_window_focus_unavailable`). No se
identificó cuál de ellas falló; no se interpreta como imposibilidad general de
entrada en macOS. `inputTested:true` corresponde al ensayo separado del puntero,
no a clics ni teclado. El plist automático quedó `.disabled-v9-after-reboot`,
sin proceso activo y con la sesión de test restaurada. `readyForUnattended`
sigue falso y la tarea 1.3 continúa abierta. Resultados sin datos personales:
[`mac-owned-input-results.json`](../../../openspec/changes/add-unattended-admin-access/mac-owned-input-results.json).

Referencia del modo de temporizador:
[Apple: RunLoop.Mode](https://developer.apple.com/documentation/foundation/runloop/mode).


### Mac 0.10.0: visibilidad y condiciones de foco antes del login

El paquete actual usa `loginwindow-report-v10.json` y
`loginwindow-stderr-v10.txt`, con esquema 10. Configura la propiedad pública
`NSWindow.canBecomeVisibleWithoutLogin`, requerida por AppKit para dibujar antes
del login, y añade los booleanos de `focusConditions`. Mantiene el nivel normal
de ventana y todas las guardas previas a los eventos; no concede permisos ni
actúa sobre ventanas de autenticación. El modo, instalación y retirada son los
mismos descritos arriba, usando los nombres v10.

En la VM, ambos permisos se renovaron sobre el bundle instalado. La captura
Aqua recibió seis fotogramas en 2859 ms; tras logout y arranque limpio recibió
once en 2452/2711 ms. En ambos casos, UID 0, consola, login incompleto,
movimiento/restauración del puntero observados. Las condiciones de contexto,
inactividad, primer responder propio y visibilidad son verdaderas; `keyWindow`
y `frontmostProcess` son falsas. Cancela sin crear/publicar clics o teclas.
La propiedad de visibilidad corrige una omisión del arnés, pero no resuelve su
activación ni demuestra que macOS impida toda entrada remota.

El informe posterior al reinicio se comprobó contra el nuevo arranque. Se
retiró el plist como `.disabled-v10-after-reboot`, se verificó la ausencia del
proceso y se restauró el escritorio de test. El Mac físico no se interrumpió.
Resultados sin datos personales:
[`mac-prelogin-window-results.json`](../../../openspec/changes/add-unattended-admin-access/mac-prelogin-window-results.json).
La tarea 1.3 sigue abierta y el agente final requiere revisión de esta evidencia.

Referencias: [Apple: agentes antes del login](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CustomLogin.html)
y [propiedad de visibilidad](https://developer.apple.com/documentation/appkit/nswindow/canbecomevisiblewithoutlogin).

### Mint: transición coordinada sin instalar servicio

`linux-session-check.py --capture-transitions` se ejecuta como root, junto a
`linux-probe.py`, con Python en modo aislado (`python3 -I`). Solo admite una
sesión X11 activa y comienza con el usuario desbloqueado. Resuelve de nuevo el
servidor Xorg y su Xauthority en cada fase, exige archivo regular privado de
root y padres sin escritura ajena, y no copia cookies ni cambia `xhost`.

El propietario debe tener su trabajo guardado y acceso físico para recuperar
la sesión. Después de `desktop_captured`, cierra sesión de Cinnamon, mantiene
LightDM visible al menos veinte segundos y vuelve a iniciar sesión con el mismo
usuario. El programa cuenta durante dos segundos una región central de 128×72
en cada contexto y comprueba que logind no haya cambiado de sesión durante el
muestreo. La vuelta debe pertenecer a una sesión nueva. No guarda/transmite
imágenes, no envía entrada, no instala servicios ni modifica LightDM. La espera
de transiciones está limitada a cinco minutos y cada capturador a doce segundos.

El resultado es `transition_capture_ok_not_certified` solo cuando observa las
tres fases. Un error o timeout no impide el inicio de sesión: termina el propio
proceso y no deja trabajos automáticos. Al ejecutar desde una sesión SSH con
`sudo`, esa conexión se puede cerrar normalmente al finalizar. Retirar después
únicamente las copias e informes propios del laboratorio; no hay configuración
de LightDM, systemd o sudoers que restaurar.

Este ensayo no acredita entrada en credenciales, polkit, bloqueo ni transporte
remoto y mantiene `readyForUnattended:false`. Un éxito no completa por sí solo
la tarea 1.4 ni permite anunciar acceso completo.


El 24/10/2026 se verificó en Mint 22.3/Cinnamon/X11/LightDM la captura de las
tres fases: diez imágenes por fase (10/9/4 no uniformes), en un recorrido
coordinado de 75424 ms. El propietario volvió al escritorio y no quedó ningún
proceso del diagnóstico. Esto no mide latencia ni reconexión remota.
Evidencia: [`mint-transition-results.json`](../../../openspec/changes/add-unattended-admin-access/mint-transition-results.json).

### Mint: bloqueo coordinado de la misma sesión

`linux-session-check.py --capture-lock` mantiene las mismas guardas, límites y
captura sin guardar imágenes. Después de `desktop_captured`, el propietario
bloquea Cinnamon sin cerrar sesión, espera veinte segundos y lo desbloquea
localmente. El diagnóstico exige `LockedHint:yes` durante el segundo muestreo y
`LockedHint:no` al regresar; cancela si cambia el identificador, usuario o clase
de sesión. Resuelve Xauthority de nuevo en cada fase y no genera entrada.

Solo las tres fases verificadas producen `lock_capture_ok_not_certified`.
Esto acredita captura durante un bloqueo observado por logind, sin demostrar
teclado, credenciales, polkit, transporte remoto ni el servicio final. El ensayo
no bloquea ni desbloquea el equipo por su cuenta y termina sin trabajos
persistentes. Un fallo no modifica la configuración ni impide desbloquearlo.

Si Cinnamon no actualiza `LockedHint`, el modo explícito
`--capture-lock --lock-source cinnamon` consulta únicamente
`org.cinnamon.ScreenSaver.GetActive` en el bus del usuario de la sesión. El
subproceso de consulta pierde UID, GID y grupos suplementarios de root; tiene
cinco segundos de límite. No envía métodos de bloqueo ni cambia ajustes. Exige
estado inactivo al empezar y al volver, y activo antes y después del muestreo
intermedio. Conserva las guardas de identidad/sesión y Xauthority.

`GetActive` informa de la actividad del salvapantallas, por lo que el propietario
debe confirmar que la pantalla exigió su contraseña. El informe distingue
`cinnamonScreensaverActive` de `locked` (el valor de logind), usa la fase
`cinnamon_screensaver_active` y el resultado
`cinnamon_screensaver_capture_ok_not_certified`. No convierte actividad del
salvapantallas en certificación automática de un bloqueo seguro.
