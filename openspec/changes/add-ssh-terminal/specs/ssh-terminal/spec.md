# Spec Delta

## Purpose

Permite abrir y usar terminales interactivas sobre conexiones SSH dentro de la aplicación, en pestañas, con un ciclo de vida claro desde que se abren hasta que se cierran o reconectan.

## ADDED Requirements

### Requirement: Abrir una terminal desde una conexión SSH
La aplicación SHALL permitir abrir una terminal interactiva desde cualquier conexión SSH, tanto desde la conexión activa como desde la propia conexión en la barra lateral. La opción MUST NOT aparecer en conexiones S3.

#### Scenario: Abrir desde la conexión activa
- **WHEN** el usuario tiene activa una conexión SSH y pulsa "Abrir terminal"
- **THEN** se abre una pestaña nueva con el nombre de la conexión, que muestra el prompt del servidor y queda seleccionada

#### Scenario: Abrir desde la barra lateral
- **WHEN** el usuario pulsa la acción de terminal de una conexión SSH que no es la activa
- **THEN** se abre una terminal a ese servidor sin cambiar la conexión activa del explorador

#### Scenario: Conexión S3
- **WHEN** la conexión activa es S3
- **THEN** no se ofrece la opción de abrir terminal

#### Scenario: Error al abrir
- **WHEN** el usuario abre una terminal y el servidor rechaza la autenticación o no responde
- **THEN** la pestaña muestra el mismo error que mostraría el explorador SFTP y ofrece reintentar

### Requirement: Varias terminales en pestañas
La aplicación SHALL mantener varias terminales abiertas a la vez, del mismo servidor o de servidores distintos, cada una en su pestaña junto a la pestaña "Archivos". Cambiar de pestaña o de conexión activa MUST NOT cerrar ni reiniciar ninguna terminal, ni perder su contenido.

#### Scenario: Dos terminales al mismo servidor
- **WHEN** el usuario abre dos terminales a la misma conexión
- **THEN** hay dos pestañas distinguibles (por ejemplo "web-01" y "web-01 (2)") con sesiones independientes

#### Scenario: Cambiar de pestaña
- **WHEN** el usuario ejecuta un comando en una terminal, cambia a "Archivos" y vuelve
- **THEN** la terminal conserva la salida anterior y la sesión sigue activa

#### Scenario: Cambiar de conexión activa
- **WHEN** el usuario tiene terminales abiertas y selecciona otra conexión en la barra lateral
- **THEN** las terminales siguen abiertas y la pestaña "Archivos" muestra la nueva conexión

### Requirement: Interacción de terminal completa
La terminal SHALL comportarse como una terminal xterm-256color: transmitir lo que escribe el usuario, mostrar colores y texto UTF-8, soportar programas a pantalla completa, y enviar Ctrl+C al servidor como interrupción.

#### Scenario: Programa a pantalla completa
- **WHEN** el usuario ejecuta `vim` o `htop` en la terminal
- **THEN** el programa se dibuja y responde al teclado, y al salir la terminal vuelve al prompt

#### Scenario: Texto UTF-8
- **WHEN** el servidor imprime `ñandú €`
- **THEN** la terminal muestra esos caracteres correctamente

#### Scenario: Interrumpir un comando
- **WHEN** el usuario ejecuta `sleep 100` y pulsa Ctrl+C
- **THEN** el comando se interrumpe y vuelve el prompt

### Requirement: Tamaño de la terminal sincronizado
Cuando cambia el tamaño visible de la terminal (ventana, barra lateral o separadores), la aplicación SHALL ajustar las filas y columnas de la sesión remota para que coincidan.

#### Scenario: Redimensionar la ventana
- **WHEN** el usuario agranda la ventana con una terminal visible y ejecuta `tput cols`
- **THEN** el valor coincide con el ancho visible de la terminal

### Requirement: Copiar y pegar
La terminal SHALL permitir copiar el texto seleccionado y pegar desde el portapapeles con los atajos de cada sistema, sin impedir que Ctrl+C llegue al servidor como interrupción.

#### Scenario: Copiar y pegar en macOS
- **WHEN** en macOS el usuario selecciona texto y pulsa Cmd+C, y luego pulsa Cmd+V
- **THEN** el texto se copia al portapapeles del sistema y se pega en la terminal

#### Scenario: Copiar y pegar en Windows y Linux
- **WHEN** en Windows o Linux el usuario selecciona texto y pulsa Ctrl+Shift+C, y luego pulsa Ctrl+Shift+V
- **THEN** el texto se copia al portapapeles del sistema y se pega en la terminal, y Ctrl+C sin Mayúsculas sigue enviando la interrupción

### Requirement: Fin de sesión y reconexión
Cuando una sesión termina, porque el usuario sale de la shell o porque se pierde la conexión, la pestaña SHALL indicarlo sin cerrarse, conservar la salida y ofrecer reconectar. Cerrar una pestaña MUST terminar su sesión en el servidor.

#### Scenario: Salir de la shell
- **WHEN** el usuario ejecuta `exit`
- **THEN** la pestaña muestra que la sesión ha terminado, conserva la salida y ofrece "Reconectar"

#### Scenario: Conexión perdida
- **WHEN** la conexión con el servidor se cae con una terminal abierta
- **THEN** la pestaña indica que se perdió la conexión y "Reconectar" abre una sesión nueva en la misma pestaña cuando el servidor vuelve

#### Scenario: Cerrar la pestaña
- **WHEN** el usuario cierra la pestaña de una terminal activa
- **THEN** la sesión remota termina y no queda ningún proceso de esa shell en el servidor
