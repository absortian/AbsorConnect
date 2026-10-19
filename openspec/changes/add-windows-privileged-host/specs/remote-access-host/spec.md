# remote-access-host

## ADDED Requirements

### Requirement: Atender el escritorio seguro en Windows
En Windows, con el componente con privilegios instalado y activado, el PC SHALL permitir ver y actuar sobre el escritorio seguro (UAC, bloqueo o inicio de sesión, Ctrl+Alt+Supr) y sobre ventanas de programas elevados. El componente MUST actuar solo para una sesión ya autenticada con la contraseña del PC, y mostrar allí un aviso de quién controla. Sin el componente, el control remoto MUST funcionar como sin él.

#### Scenario: Responder a un UAC
- **WHEN** alguien controla un PC Windows con el componente activado y en el PC aparece un aviso de UAC
- **THEN** el controlador ve el aviso y puede pulsar "Sí" o "No"

#### Scenario: Volver tras bloquear
- **WHEN** el PC controlado se bloquea durante la sesión
- **THEN** el controlador ve la pantalla de bloqueo, puede escribir la contraseña de Windows y continuar, y en el PC se ve un aviso de que lo están controlando

#### Scenario: Ventana de programa elevado
- **WHEN** en el PC controlado hay abierta una ventana de un programa ejecutado como administrador
- **THEN** el ratón y el teclado del controlador actúan sobre esa ventana

#### Scenario: Sin el componente con privilegios
- **WHEN** se controla un PC Windows en el que el componente con privilegios no está instalado o está desactivado
- **THEN** la sesión funciona como en la versión sin ese componente, sin acceso al escritorio seguro ni a las ventanas elevadas

#### Scenario: El componente no actúa sin sesión autenticada
- **WHEN** no hay una sesión de control autenticada con la contraseña del PC
- **THEN** el componente con privilegios no captura la pantalla ni aplica entrada

## MODIFIED Requirements

### Requirement: Entrada de teclado y ratón
El PC SHALL aplicar el movimiento, los botones, el doble clic, el arrastre y la rueda (vertical y horizontal) del ratón en la posición indicada de la pantalla elegida. MUST aplicar las teclas por su posición física con la distribución del propio PC, y el texto escrito tal cual. En Windows, con el componente con privilegios activado, la entrada MUST llegar también a las ventanas de programas elevados y al escritorio seguro.

#### Scenario: Distribución del teclado
- **WHEN** el controlador pulsa la tecla situada a la derecha de la L en un teclado español y el PC controlado usa distribución española
- **THEN** en el PC controlado se escribe "ñ"

#### Scenario: Texto desde el móvil
- **WHEN** un móvil envía el texto "¿Año 2026? €"
- **THEN** en el PC controlado aparece exactamente ese texto

#### Scenario: Pantalla con escalado
- **WHEN** el PC controlado tiene una pantalla con escalado al 150 % y el controlador hace clic sobre un botón que ve en la imagen
- **THEN** el clic llega a ese botón

### Requirement: Sistemas en los que se puede controlar el PC
El control remoto de este PC SHALL estar disponible en Windows 10 y 11, en macOS y en Linux con sesión X11. En Linux con Wayland, Ajustes MUST mostrar que el sistema no lo permite y no dejar activarlo. En Windows sin el componente con privilegios, Ajustes MUST explicar lo que no se puede controlar: pantalla de bloqueo o de inicio de sesión, avisos de UAC y programas elevados. En Windows con el componente con privilegios instalado y activado, Ajustes MUST indicar que esos casos sí se pueden atender. En macOS y en Linux, la pantalla de bloqueo y la de inicio de sesión siguen fuera.

#### Scenario: Linux con Wayland
- **WHEN** alguien abre Ajustes en un Linux con sesión Wayland
- **THEN** la sección de control remoto de este PC explica que su sesión no lo permite, sugiere usar una sesión X11, y el interruptor está desactivado

#### Scenario: Windows con el componente activado
- **WHEN** alguien abre Ajustes en un Windows con el componente con privilegios instalado y activado
- **THEN** la sección de control remoto de este PC indica que también se pueden atender el UAC, la pantalla de bloqueo y los programas elevados

#### Scenario: Windows sin el componente
- **WHEN** alguien abre Ajustes en un Windows sin el componente con privilegios
- **THEN** la sección de control remoto de este PC explica que no se pueden controlar la pantalla de bloqueo o de inicio de sesión, los avisos de UAC ni los programas elevados
