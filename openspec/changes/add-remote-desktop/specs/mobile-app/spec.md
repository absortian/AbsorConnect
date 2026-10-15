# Spec Delta

## ADDED Requirements

### Requirement: Equipos y control remoto desde el móvil
La app SHALL mostrar los PCs de la cuenta con su estado, igual que el escritorio, y conectarse a uno disponible con su contraseña, con los mismos mensajes de error. La sesión MUST verse a pantalla completa, en vertical y en horizontal.

#### Scenario: Conectar desde el móvil
- **WHEN** alguien abre "Equipos" en el móvil, elige un PC disponible e introduce su contraseña
- **THEN** ve la pantalla de ese PC

#### Scenario: Girar el teléfono
- **WHEN** alguien gira el teléfono durante una sesión
- **THEN** la imagen se adapta a la nueva orientación sin cortar la sesión

### Requirement: Manejo táctil del PC remoto
La app SHALL ofrecer un modo ratón (el dedo mueve un puntero como en un trackpad) y un modo táctil (el toque hace clic donde se toca), con clic derecho, arrastre, desplazamiento con dos dedos y zoom con pellizco. MUST tener teclado del teléfono y una barra con Esc, Tab, Ctrl, Alt, Supr, la tecla del sistema, flechas y teclas de función.

#### Scenario: Clic derecho
- **WHEN** alguien toca con dos dedos a la vez en modo ratón
- **THEN** el PC remoto recibe un clic derecho en la posición del puntero

#### Scenario: Escribir texto
- **WHEN** alguien escribe "Mañana" con el teclado del teléfono
- **THEN** en el PC remoto aparece "Mañana"

#### Scenario: Combinación con Ctrl
- **WHEN** alguien toca Ctrl en la barra de teclas y después escribe "c"
- **THEN** el PC remoto recibe Ctrl+C

### Requirement: Pantallas, portapapeles, sonido y ficheros desde el móvil
Según lo que permita el PC, la app SHALL cambiar de pantalla, compartir el portapapeles de texto en los dos sentidos, reproducir el sonido con opción de silenciarlo, enviar ficheros desde Archivos o Fotos y descargar ficheros del PC a la hoja de compartir.

#### Scenario: Enviar una foto
- **WHEN** alguien elige "Enviar fichero" y selecciona una foto durante una sesión
- **THEN** la foto aparece en la carpeta de recepción del PC remoto

#### Scenario: Copiar desde el PC
- **WHEN** alguien copia un texto en el PC remoto
- **THEN** puede pegarlo en otra app del teléfono

### Requirement: Sesión al salir de la app móvil
Si la app pasa a segundo plano durante una sesión, la sesión SHALL mantenerse hasta 30 segundos y recuperarse al volver sin pedir la contraseña. Pasado ese tiempo, MUST cerrarse.

#### Scenario: Volver enseguida
- **WHEN** alguien sale a otra app durante 10 segundos y vuelve
- **THEN** la sesión sigue o se recupera sola sin pedir la contraseña

#### Scenario: Volver tarde
- **WHEN** alguien vuelve a la app tras 2 minutos fuera
- **THEN** la sesión está cerrada y puede volver a conectar con la contraseña
