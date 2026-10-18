# Spec Delta

## Purpose

Define cómo se controla desde la app de escritorio un PC de la misma cuenta: la lista de equipos, la conexión con la contraseña del PC y la ventana de sesión con imagen, teclado, ratón, pantallas, portapapeles, ficheros, sonido y estado de la conexión.

## ADDED Requirements

### Requirement: Equipos de la cuenta
La app SHALL tener una sección "Equipos" con los PCs de la cuenta: nombre, sistema, si están en línea y si se pueden controlar (disponible, control remoto desactivado, faltan permisos u ocupado). El propio PC MUST aparecer marcado y sin opción de conectar. La lista MUST actualizarse sola mientras esté visible.

#### Scenario: PC que se enciende
- **WHEN** la sección Equipos está abierta y otro PC de la cuenta arranca la app con el control remoto activado
- **THEN** ese PC pasa a aparecer como disponible sin que haga falta recargar a mano

#### Scenario: PC sin control remoto
- **WHEN** un PC de la cuenta está en línea con el control remoto desactivado
- **THEN** aparece como "Control remoto desactivado" y no permite conectar

### Requirement: Conectar con la contraseña del PC
Al elegir un PC disponible, la app SHALL pedir su contraseña y abrir la sesión, en condiciones normales en menos de 10 segundos. Cada fallo MUST explicarse con su causa en el idioma de la app.

#### Scenario: Conexión correcta
- **WHEN** alguien elige un PC disponible e introduce su contraseña correcta
- **THEN** se abre una ventana de sesión con la pantalla de ese PC

#### Scenario: Fallos comprensibles
- **WHEN** la conexión falla por contraseña incorrecta, PC bloqueado (con el tiempo restante), PC ocupado, PC sin conexión, control remoto desactivado, permisos que faltan, confirmación denegada o red que no permite conectar
- **THEN** la app muestra un mensaje específico de ese caso

### Requirement: Ventana de sesión
Cada sesión SHALL abrirse en su propia ventana titulada con el nombre del PC. Se MUST poder tener sesiones abiertas con varios PCs a la vez. Cerrar la ventana termina la sesión.

#### Scenario: Dos PCs a la vez
- **WHEN** alguien abre una sesión con el PC A y otra con el PC B
- **THEN** cada una está en su ventana, y manejar una no afecta a la otra

### Requirement: Imagen del PC remoto
La ventana SHALL mostrar la pantalla del PC remoto en tiempo real, ajustada a la ventana por defecto, con opción de tamaño real con desplazamiento y de pantalla completa. La calidad MUST adaptarse a la red sin cortar la sesión.

#### Scenario: Tamaño real
- **WHEN** alguien cambia a tamaño real en una ventana más pequeña que la pantalla remota
- **THEN** ve la pantalla a escala 1:1 y puede desplazarse por ella

### Requirement: Teclado y ratón en el PC remoto
Con la ventana enfocada, el ratón (movimiento, botones, rueda) y el teclado SHALL actuar sobre el PC remoto en el punto equivalente de la imagen, a cualquier escala. En pantalla completa, los atajos del sistema MUST enviarse al PC remoto donde el sistema lo permita, y un menú MUST enviar las combinaciones que no se pueden capturar.

#### Scenario: Atajo en pantalla completa
- **WHEN** alguien en Windows o Linux pulsa Alt+Tab con la sesión a pantalla completa
- **THEN** el cambio de ventana ocurre en el PC remoto y no en el local

#### Scenario: Combinación desde el menú
- **WHEN** alguien en macOS elige "Cmd+Tab" o "Tecla Windows" en el menú de combinaciones
- **THEN** el PC remoto recibe esa combinación

#### Scenario: Teclas que no se quedan pulsadas
- **WHEN** alguien mantiene pulsado Ctrl y cambia a otra ventana local
- **THEN** el PC remoto recibe la tecla Ctrl soltada

### Requirement: Elegir pantalla
Si el PC remoto tiene varias pantallas, la ventana SHALL mostrar un selector para cambiar entre ellas durante la sesión.

#### Scenario: Selector de pantallas
- **WHEN** alguien se conecta a un PC con tres monitores
- **THEN** ve la pantalla principal y un selector con las tres

### Requirement: Portapapeles compartido
Si el PC remoto lo permite, el texto y las imágenes copiados en un equipo SHALL poder pegarse en el otro, en los dos sentidos, mientras dure la sesión. La ventana MUST permitir pausar la sincronización.

#### Scenario: Copiar en el PC remoto
- **WHEN** alguien copia un texto en el PC remoto y pega en una app local
- **THEN** se pega ese texto

#### Scenario: Sincronización en pausa
- **WHEN** la sincronización está en pausa y alguien copia una imagen en el equipo local
- **THEN** el portapapeles del PC remoto no cambia

### Requirement: Envío y descarga de ficheros
Si el PC remoto lo permite, la ventana SHALL enviar ficheros arrastrándolos sobre ella o desde un botón, y descargarlos desde un explorador de las carpetas del PC remoto. Cada transferencia MUST mostrar su progreso, poder cancelarse y avisar si falla.

#### Scenario: Enviar arrastrando
- **WHEN** alguien arrastra dos ficheros sobre la ventana de sesión
- **THEN** se envían con su progreso y aparecen en la carpeta de recepción del PC remoto con su contenido íntegro

#### Scenario: Descargar del PC remoto
- **WHEN** alguien abre "Descargar del equipo", elige un fichero del PC remoto y un destino local
- **THEN** el fichero se guarda en el destino con su contenido íntegro

### Requirement: Sonido del PC remoto
Si el PC remoto lo permite y puede capturarlo, la ventana SHALL reproducir su sonido, con un botón para silenciarlo. Si no, MUST indicar que el sonido no está disponible.

#### Scenario: Silenciar
- **WHEN** alguien pulsa el botón de silencio durante una sesión con sonido
- **THEN** deja de oírse el PC remoto y la sesión continúa

### Requirement: Estado de la conexión
La ventana SHALL mostrar si la conexión es directa o por relé, la latencia y las imágenes por segundo. Si la conexión se pierde, MUST intentar recuperarla sola durante 30 segundos sin volver a pedir la contraseña; si no lo logra, ofrece reconectar.

#### Scenario: Corte breve de la red
- **WHEN** la red del controlador se corta 10 segundos durante una sesión
- **THEN** la sesión se recupera sola sin pedir la contraseña

#### Scenario: Conexión por relé
- **WHEN** la red de uno de los equipos no permite la conexión directa
- **THEN** la sesión funciona y la ventana indica que va por relé

### Requirement: Controlar desde cualquier sistema
El control de otros PCs SHALL estar disponible en todos los sistemas de escritorio soportados por la app, incluido Linux con Wayland, y MUST NOT requerir permisos especiales del sistema.

#### Scenario: Controlador en Wayland
- **WHEN** alguien en Linux con Wayland se conecta a un PC con Windows
- **THEN** ve y maneja ese PC con normalidad
