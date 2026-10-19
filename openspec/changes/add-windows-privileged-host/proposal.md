# Proposal

## Why

El control remoto de Absor Connect (change `add-remote-desktop`, en producción desde la v0.4.0) corre como una app normal del usuario. En Windows eso deja fuera, a propósito, lo que una app sin privilegios no puede tocar: el aviso de Control de cuentas de usuario (UAC), la pantalla de bloqueo o de inicio de sesión, el Ctrl+Alt+Supr real y las ventanas de programas abiertos como administrador. Son casos habituales al administrar un PC a distancia (instalar algo, confirmar un UAC, entrar tras un reinicio), y hoy obligan a volver a AnyDesk, TeamViewer o Chrome Remote Desktop, que sí los cubren porque instalan un servicio del sistema.

Este cambio añade en Windows un servicio como esas herramientas, manteniendo las garantías que el control remoto ya tiene: nada ocurre antes de verificar la contraseña del PC, y mientras dura una sesión el PC avisa de quién lo controla y permite cortarla.

## What Changes

- **Servicio de Windows con privilegios (equipo controlado):** el instalador registra un servicio que corre como `LocalSystem`. Cuando una sesión ya autenticada lo necesita, el servicio lanza un ayudante en el escritorio activo del usuario, incluido el escritorio seguro (UAC, bloqueo, Ctrl+Alt+Supr), para capturar la imagen y aplicar teclado y ratón allí. Así el controlador ve y puede responder a esos avisos, y manejar ventanas elevadas.
- **El instalador pasa a ser por equipo (per-machine):** registrar un servicio exige privilegios, así que el instalador NSIS se eleva una vez al instalar. Se mantiene la actualización automática.
- **Ajustes lo refleja:** en Windows, la sección "Control remoto de este PC" deja de listar el UAC, la pantalla de bloqueo y los programas elevados como limitaciones, y explica que el PC también se puede atender en esos casos. Un interruptor permite desactivar el componente con privilegios (y entonces vuelve el comportamiento actual, sin escritorio seguro).
- **Seguridad:** el servicio no hace nada por su cuenta. Solo actúa a petición de la app del usuario ya autenticada en una sesión, por un canal local reducido (IPC) y con un conjunto de operaciones acotado (capturar la pantalla activa, aplicar una entrada ya validada). El aviso de sesión se muestra también en el escritorio seguro, para que quien esté delante del PC vea que lo están controlando aunque sea en la pantalla de bloqueo.
- **Fin del "fuera de alcance" correspondiente:** este change levanta el punto del change `add-remote-desktop` que dejaba el escritorio seguro fuera por requerir un servicio del sistema.

## Fuera de alcance

- **macOS y Linux:** no se añade el equivalente. En macOS la pantalla de bloqueo y la de inicio de sesión siguen fuera; en Linux igual. Solo cambia Windows.
- **Acceso desatendido sin cuenta ni contraseña:** se mantiene el modelo actual. El servicio nunca permite controlar sin la contraseña del PC verificada; no se añade un modo "sin vigilancia" distinto del que ya hay (la app en segundo plano con el control remoto activado).
- **Instalación en modo portable o sin privilegios:** quien no quiera el servicio puede no instalar ese componente (o desactivarlo en Ajustes) y queda el control remoto actual, sin escritorio seguro.
- **Cambiar el modelo de autenticación o el protocolo v1:** el servicio reutiliza la sesión ya autenticada; no toca la prueba de contraseña ni el protocolo de los canales.
- **uiAccess=true como alternativa al servicio:** exige un certificado de firma de confianza que el proyecto no tiene (ver `design.md`).
