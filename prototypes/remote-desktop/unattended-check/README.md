# Viabilidad del host desatendido

Herramientas para las tareas 1.1–1.4 de `add-unattended-admin-access`. Son pruebas
de entorno, no el agente ni una certificación del acceso remoto. Los inventarios
son de solo lectura; las capturas opcionales no guardan ni transmiten imágenes.
No inyectan entrada ni instalan servicios. La preparación UAC de laboratorio
descrita abajo solo aplica cambios o reinicia con opciones explícitas.
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
una vez por contexto, cuenta fotogramas durante dos segundos y termina. No tiene
KeepAlive, scripts de instalación, entrada, red ni cambios de la configuración de
loginwindow. Un fallo del diagnóstico no es condición para permitir iniciar sesión.

Instalar requiere la autorización administrativa del propietario; cerrar la sesión
para probarlo también se coordina con él. No instalar durante trabajo sin guardar.
Archivos propios del paquete:

- `/Library/Application Support/AbsorConnectLab/AbsorUnattendedProbe.app`.
- `/Library/LaunchAgents/com.absor.unattended.probe.loginwindow.plist`.
- `/Library/Logs/AbsorConnectLab/`, privado de root, para dos informes sin píxeles.

Recuperación: iniciar sesión normalmente, retirar primero ese plist con permisos
administrativos para impedir futuras ejecuciones y retirar solo el bundle y los
dos informes propios indicados. El proceso es de una sola ejecución; no hay un
servicio en reinicio continuo que deba pararse. No tocar launch agents de Apple ni
preferencias del sistema. La lista exacta del payload queda junto al paquete.
Olvidar el recibo con `pkgutil --forget com.absor.unattended.probe.loginwindow`
solo retira el recibo; no desinstala los archivos.

Esta prueba no presupone que TCC autorice la captura fuera de la sesión del usuario.
Su resultado pendiente debe decidir si hace falta revisar la arquitectura Mac.

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
El trabajador abre el escritorio de entrada, cuenta capturas GDI durante dos
segundos a 320 × 180 y termina. No crea ventanas, no cambia el escritorio visible,
no guarda imágenes, no aplica entrada y no instala un servicio SCM.

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

## Criterio de avance

Conservar las tareas sin marcar hasta completar todos sus escenarios reales.
Registrar por separado los casos comprobados y los pendientes en el cambio
OpenSpec. No publicar «acceso completo» ni activar el servicio a partir de estos
diagnósticos de entorno.
