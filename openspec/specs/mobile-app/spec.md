# mobile-app Specification

## Purpose
Define la app de Absor Connect para Android e iOS: acceso con la misma cuenta del servicio en la nube, conexiones sincronizadas con el escritorio, claves privadas guardadas solo en el dispositivo, explorador de archivos SFTP y S3, y terminal SSH.

## Requirements

### Requirement: Acceso con la cuenta
Sin una sesión válida, la app SHALL mostrar únicamente la pantalla de acceso (iniciar sesión o crear cuenta), con los mismos errores comprensibles que el escritorio. La sesión MUST recordarse entre reinicios con el token cifrado en el almacén seguro del sistema (Keychain o Keystore), y una sesión caducada o revocada MUST devolver a la pantalla de acceso.

#### Scenario: Primer arranque
- **WHEN** alguien abre la app sin haber iniciado sesión en ese dispositivo
- **THEN** ve la pantalla de acceso y ninguna conexión

#### Scenario: Misma cuenta que en el escritorio
- **WHEN** alguien inicia sesión en el móvil con la cuenta que usa en el escritorio
- **THEN** ve las mismas conexiones y carpetas

#### Scenario: Sesión revocada
- **WHEN** la sesión del móvil deja de ser válida (cambio de contraseña en otro equipo o restablecimiento)
- **THEN** en la siguiente operación con el servicio la app vuelve a la pantalla de acceso con un aviso

### Requirement: Conexiones sincronizadas
La app SHALL permitir ver, crear, editar, mover entre carpetas y borrar conexiones S3 y SSH y carpetas, guardándolas en la cuenta con el mismo control de revisión que el escritorio. Si otro equipo guardó antes, MUST recargar la lista y avisar de que el último cambio no se guardó. Al volver a la app tras al menos 30 segundos, y al deslizar para recargar, MUST mostrar los cambios hechos desde otros equipos.

#### Scenario: Conexión creada en el escritorio
- **WHEN** alguien crea una conexión en el escritorio y vuelve a la app del móvil
- **THEN** la conexión aparece en la lista del móvil

#### Scenario: Conexión creada en el móvil
- **WHEN** alguien crea una conexión SSH en el móvil
- **THEN** aparece en el escritorio la próxima vez que este lee la lista

#### Scenario: Conflicto al guardar
- **WHEN** el móvil guarda un cambio sobre una lista que otro equipo modificó después
- **THEN** la app muestra la lista actual y avisa de que el cambio no se guardó

### Requirement: Claves privadas en el dispositivo
Las conexiones SSH por clave privada SHALL usar una clave importada en ese dispositivo y guardada en su almacén seguro. El contenido de la clave MUST NOT enviarse al servicio ni a ningún otro sitio; la cuenta solo guarda el nombre o la ruta del fichero y, si la hay, la passphrase cifrada.

#### Scenario: Clave aún no importada
- **WHEN** alguien abre una conexión por clave privada creada en el escritorio
- **THEN** la app le pide importar el fichero de la clave en ese dispositivo y después conecta

#### Scenario: La clave no sale del teléfono
- **WHEN** alguien importa una clave privada y guarda la conexión
- **THEN** la lista guardada en la cuenta contiene el nombre del fichero y no su contenido

### Requirement: Explorador SFTP y S3
La app SHALL permitir navegar por los directorios de un servidor SFTP y por los buckets y prefijos de un servicio S3, subir ficheros elegidos con el selector del sistema (Archivos o Fotos), descargar un fichero y compartirlo o guardarlo, crear carpetas y borrar ficheros y carpetas (con confirmación). Cada transferencia MUST mostrar su progreso y su error si falla.

#### Scenario: Descargar y compartir
- **WHEN** alguien toca un fichero de un servidor SFTP y elige descargarlo
- **THEN** ve el progreso y, al terminar, puede compartirlo o guardarlo en el dispositivo

#### Scenario: Subir desde el teléfono
- **WHEN** alguien elige "Subir" en un prefijo de un bucket S3 y selecciona una foto
- **THEN** la foto se sube a ese prefijo y aparece en el listado

#### Scenario: Borrar una carpeta
- **WHEN** alguien borra una carpeta y confirma
- **THEN** se borra con todo su contenido y desaparece del listado

### Requirement: Endpoint y errores de S3
Un endpoint S3 escrito sin esquema SHALL completarse con `https://`. Los fallos de S3 (acceso denegado, redirección, certificado no válido, dirección no válida) MUST explicarse con su causa en vez de con un error genérico.

#### Scenario: Endpoint S3 sin https://
- **WHEN** alguien guarda una conexión S3 con el endpoint `s3.ejemplo.com`
- **THEN** se guarda como `https://s3.ejemplo.com` y el explorador lista sus buckets

#### Scenario: El servidor S3 redirige
- **WHEN** el endpoint usa `http://` y el servidor redirige a `https://`
- **THEN** el explorador dice a qué dirección redirige el servidor, en vez de mostrar "acceso denegado"

### Requirement: Terminal SSH
La app SHALL abrir terminales interactivas sobre conexiones SSH, con colores, programas a pantalla completa, ajuste al tamaño de la pantalla y una barra de teclas especiales (Esc, Tab, Ctrl, flechas). MUST permitir tener varias sesiones abiertas a la vez, cambiar entre ellas y reconectar una sesión cerrada.

#### Scenario: Ejecutar un comando
- **WHEN** alguien abre una terminal en una conexión SSH y escribe un comando
- **THEN** ve su salida como en una terminal de escritorio

#### Scenario: Teclas especiales
- **WHEN** alguien pulsa Ctrl y luego C en la barra de teclas
- **THEN** el servidor recibe la interrupción del programa en curso

#### Scenario: Varias sesiones
- **WHEN** alguien tiene abiertas dos terminales y cambia de una a otra
- **THEN** ambas siguen conectadas y conservan su contenido

### Requirement: Idioma
La app SHALL mostrarse en español o en inglés según el idioma del sistema, con inglés por defecto.

#### Scenario: Teléfono en español
- **WHEN** alguien abre la app en un teléfono configurado en español
- **THEN** todos los textos aparecen en español

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
