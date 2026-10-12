# Spec Delta

## Purpose

Define la app de Absor Connect para Android e iOS: acceso con la misma cuenta del servicio en la nube, conexiones sincronizadas con el escritorio, claves privadas guardadas solo en el dispositivo, explorador de archivos SFTP y S3, y terminal SSH.

## ADDED Requirements

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
