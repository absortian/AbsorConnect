# Design

## Context

El host del control remoto (`src/main/remote/`, change `add-remote-desktop`) corre como el usuario con la sesión abierta. Captura con `desktopCapturer` e inyecta entrada con `koffi` (`SendInput`). Dos límites de Windows quedan fuera por diseño:

- **Escritorio seguro (secure desktop):** el UAC, la pantalla de bloqueo o de inicio de sesión y el Ctrl+Alt+Supr se dibujan en un escritorio aparte (`Winlogon`) de la estación de ventanas interactiva. Un proceso del usuario no captura ni envía entrada ahí.
- **UIPI (User Interface Privilege Isolation):** un proceso de integridad media no envía mensajes de ventana (ni `SendInput` efectivo) a ventanas de un proceso de integridad alta (programas "como administrador").

Las herramientas comparables (Chrome Remote Desktop, AnyDesk, TeamViewer) resuelven ambos con un **servicio de Windows como `LocalSystem`** que lanza un proceso ayudante en el escritorio que esté activo en cada momento. Este change hace lo mismo para Windows, y solo para Windows.

El principio rector es que el servicio **no amplía quién puede controlar el PC ni cuándo**: todo sigue pasando por la sesión del usuario ya autenticada con la contraseña del PC (change `add-remote-desktop`, requisitos "Contraseña local del PC" y "Autenticación de cada conexión"). El servicio solo amplía **dónde** puede actuar esa sesión (también en el escritorio seguro y sobre ventanas elevadas).

## Goals / Non-Goals

**Goals**
- Que el controlador vea y pueda responder al UAC, a la pantalla de bloqueo o de inicio de sesión, al Ctrl+Alt+Supr y a las ventanas elevadas de un PC Windows.
- Mantener intactas las garantías actuales: nada antes de verificar la contraseña, una sesión a la vez, aviso en el PC y corte, confirmación local opcional, registro.
- Que el aviso de "te están controlando" se vea también en el escritorio seguro.
- Instalación y actualización sin pasos manuales más allá de una elevación al instalar.

**Non-Goals**
- macOS y Linux: sin cambios.
- Acceso desatendido distinto del actual, o sin contraseña.
- Un canal de control del servicio accesible desde la red: el servicio solo habla con la app local.

## Decisions

### D1. Arquitectura: servicio `LocalSystem` + ayudante por escritorio

- **Servicio** (`AbsorConnectHost`, nativo, no Electron): corre como `LocalSystem`, arranca con el equipo, sin ventana. No abre puertos de red ni consulta la cuenta. Su única entrada es el IPC local (D4).
- **Ayudante de sesión** (`absor-host-helper`): el servicio lo lanza en la sesión de consola activa con `CreateProcessAsUser` sobre el token de esa sesión (`WTSQueryUserToken` de `WTSGetActiveConsoleSessionId`), y lo re-lanza en el escritorio que toque. El ayudante hace la captura y el `SendInput` en el escritorio al que está adjunto.
- **Por qué dos piezas:** `LocalSystem` no puede dibujar ni leer directamente el escritorio interactivo de un usuario; tiene que entrar "como" la sesión. Separar el servicio (privilegio, sin UI) del ayudante (en el escritorio, sin privilegio propio más allá del token de sesión) limita lo que corre con permisos altos.

### D2. Seguir el escritorio activo, incluido el seguro

- El escritorio de entrada cambia entre `Default` (escritorio normal del usuario) y `Winlogon` (UAC, bloqueo, Ctrl+Alt+Supr). El ayudante detecta el cambio (`OpenInputDesktop` / `GetThreadDesktop` / `SwitchDesktop` observado) y se re-adjunta con `SetThreadDesktop` al escritorio de entrada actual.
- En el escritorio `Winlogon`, la captura y `SendInput` solo funcionan desde un proceso en la sesión adecuada lanzado por el servicio; por eso el ayudante lo arranca el servicio y no la app del usuario.
- El cambio de escritorio no corta la sesión de control: el controlador ve cómo la pantalla pasa al UAC y puede pulsarlo.

### D3. La app del usuario sigue mandando; el servicio obedece

- La app de Electron (`src/main/remote/`) mantiene la sesión WebRTC, la negociación por la API y, sobre todo, **la verificación de la contraseña del PC**. El servicio no participa en la autenticación.
- Cuando una sesión está autenticada y necesita el escritorio seguro o una ventana elevada, la app pide al servicio, por el IPC (D4), que capture el escritorio activo o aplique una entrada **ya validada** (las mismas estructuras del protocolo v1, ya normalizadas).
- Si el servicio no está (desactivado, o instalación sin él), el host usa la ruta actual (`desktopCapturer` + `SendInput` del propio proceso) y el comportamiento es el de la v0.4.0.

### D4. IPC local reducido y autenticado

- Canal local only: named pipe `\\.\pipe\AbsorConnectHost` con descriptor de seguridad que solo admite al usuario de la sesión de consola interactiva y a `LocalSystem` (sin red, sin otros usuarios).
- La app se identifica ante el servicio con un secreto efímero por arranque: el servicio escribe un token en una ruta que solo `LocalSystem` y ese usuario pueden leer, y la app lo presenta al conectar. Evita que otro proceso del usuario hable con el servicio.
- Operaciones del IPC, acotadas y sin estado de cuenta:
  - `attach`/`detach`: el servicio empieza o deja de lanzar el ayudante para una sesión de control en curso;
  - `frame`: el ayudante entrega el último fotograma del escritorio activo (reusa la tubería de vídeo existente; el detalle de transporte se decide en implementación);
  - `input`: una entrada ya validada (mover, botón, tecla por posición, texto), idéntica a la del protocolo v1;
  - `notice`: mostrar/ocultar el aviso de sesión en el escritorio seguro (D6).
- El servicio **no** expone: abrir ficheros arbitrarios, ejecutar comandos, ni nada fuera de capturar el escritorio activo y aplicar una entrada ya validada.

### D5. Ciclo de vida y correspondencia con una sesión autenticada

- El servicio solo lanza el ayudante mientras hay una sesión de control **autenticada** (la app se lo dice con `attach` tras verificar la contraseña, y con `detach` al terminar o al cortar).
- Si la app muere sin `detach` (cuelgue), el servicio detecta la caída de la tubería y repliega el ayudante: no se queda capturando el escritorio seguro sin una sesión viva.
- Una sola sesión a la vez, como ya exige la spec: el servicio rechaza un segundo `attach`.

### D6. El aviso también en el escritorio seguro

- El aviso de "te están controlando" (hoy una ventana de la app) debe verse también en el escritorio seguro, donde la app del usuario no puede dibujar. El ayudante, ya adjunto a `Winlogon`, pinta ahí un aviso equivalente (quién controla; en el escritorio seguro no hay botón de cortar, porque la interacción está limitada, pero el corte sigue disponible en el escritorio normal y desde el propio controlador).
- Objetivo: que quien esté físicamente delante del PC no pueda ser observado en el UAC o en el bloqueo sin señal alguna.

### D7. Instalador y actualización

- **Per-machine:** el NSIS pasa a instalación por equipo y se eleva una vez al instalar (`electron-builder.yml`: `nsis.perMachine: true`, elevación; se registra y arranca el servicio en el paso de instalación, y se detiene y elimina al desinstalar).
- **Datos:** la configuración del control remoto sigue siendo por usuario (`userData`), porque la contraseña del PC y el registro son de la cuenta de ese usuario; el servicio no guarda estado de cuenta.
- **Actualización:** `electron-updater` sustituye la app; el servicio solo se reemplaza si cambia su binario (se versiona aparte y se actualiza en el mismo flujo, con cuidado de no cortar una sesión en curso). Detalle fino en implementación.
- **Firma:** se mantiene la situación actual (sin certificado de Apple en macOS; en Windows el instalador va sin firmar o con firma propia). El servicio no exige `uiAccess`, que sí necesitaría certificado de confianza (ver Alternativas).

### D8. Qué cambia en la spec

- "Sistemas en los que se puede controlar el PC": en Windows deja de listar UAC, bloqueo y programas elevados como lo que no se puede controlar, condicionado a que el componente con privilegios esté instalado y activado.
- Nuevo requisito "Atender el escritorio seguro en Windows", con el servicio, la correspondencia con una sesión autenticada y el aviso en el escritorio seguro.
- "Entrada de teclado y ratón": añadir que, con el servicio, la entrada llega también a ventanas elevadas y al escritorio seguro.

## Alternativas y por qué no

- **Ejecutar Absor Connect "como administrador":** cubre las ventanas elevadas (UIPI), pero **no** el escritorio seguro (UAC, bloqueo): un proceso de integridad alta sigue sin estar en `Winlogon`. Útil como apaño parcial (ya se menciona a los usuarios), insuficiente para el objetivo.
- **`uiAccess=true` en el manifiesto:** permite a una app de usuario saltar parte de UIPI, pero exige que el binario esté firmado con un certificado de confianza e instalado en una ubicación protegida. El proyecto no tiene ese certificado, y aun así `uiAccess` no da el escritorio seguro completo. Descartado.
- **Desactivar el escritorio seguro de UAC** (`PromptOnSecureDesktop=0`): debilita la seguridad del PC para todo, no solo para Absor Connect, y tampoco deja pulsar el UAC de forma fiable a distancia. Rechazado.
- **No hacerlo:** seguir remitiendo a AnyDesk/TeamViewer para esos casos. Es el estado actual; este change existe porque el propietario quiere cubrirlos con la herramienta propia.

## Riesgos

- **Superficie de ataque:** un servicio `LocalSystem` es un objetivo valioso. Se mitiga con el IPC local restringido (D4), sin red, operaciones acotadas (D5), y actuando solo para una sesión ya autenticada. Conviene una revisión de seguridad específica antes de publicar, como se hizo con el relé TURN.
- **Compatibilidad de Windows:** el seguimiento del escritorio de entrada y `WTSGetActiveConsoleSessionId` dependen de detalles del sistema (cambio rápido de usuario, RDP, varias sesiones). Hay que probarlo en la VM de Windows con esos casos.
- **Antivirus / SmartScreen:** un servicio nuevo sin firmar que captura el escritorio seguro puede activar alarmas. La firma del instalador y una descripción clara ayudan; es otra razón para valorar un certificado de firma de Windows.
- **Actualización de un servicio en uso:** reemplazar el binario del servicio sin cortar una sesión en curso requiere cuidado (D7).

## Plan de verificación

- En la VM de Windows 11 de `prototypes/remote-desktop/` (dos VMs ya preparadas): controlar el PC y provocar un UAC (abrir algo que lo pida), bloquear el PC, enviar Ctrl+Alt+Supr desde el menú de combinaciones, abrir el Administrador de tareas como administrador y comprobar que el ratón y el teclado llegan.
- Comprobar que, sin el servicio (desactivado en Ajustes), el comportamiento es el de la v0.4.0.
- Caída de la app durante una sesión en el escritorio seguro: el servicio repliega el ayudante.
- Instalación, actualización y desinstalación dejan el servicio en el estado correcto (registrado/eliminado).
- Revisión de seguridad del IPC y del servicio antes de la release.
