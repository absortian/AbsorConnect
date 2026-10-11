# Spec Delta

## Purpose

Permite explorar y gestionar los archivos de un servidor SSH mediante SFTP en el panel remoto del doble panel, con las mismas interacciones y la misma cola de transferencias que el explorador S3.

## ADDED Requirements

### Requirement: Navegación remota por SFTP
Cuando la conexión activa es de tipo SSH, el panel remoto SHALL mostrar el contenido de un directorio del servidor (carpetas primero, luego archivos con tamaño y fecha) y permitir entrar en carpetas y volver a la carpeta padre. La navegación MUST empezar en el directorio inicial configurado o, si no hay, en el directorio home del usuario remoto.

#### Scenario: Abrir una conexión SSH
- **WHEN** el usuario selecciona una conexión SSH sin directorio inicial
- **THEN** el panel remoto muestra el contenido del home del usuario en el servidor y su ruta

#### Scenario: Directorio inicial configurado
- **WHEN** el usuario selecciona una conexión SSH con directorio inicial `/var/www`
- **THEN** el panel remoto muestra el contenido de `/var/www`

#### Scenario: Entrar y salir de carpetas
- **WHEN** el usuario abre una carpeta y después pulsa "atrás"
- **THEN** el panel muestra el contenido de la carpeta y luego vuelve al directorio anterior

#### Scenario: Directorio sin permisos
- **WHEN** el usuario intenta abrir un directorio que el servidor no le deja leer
- **THEN** el panel muestra un error de permisos y sigue en el directorio en el que estaba

### Requirement: Subida de archivos al servidor
El usuario SHALL poder subir uno o varios archivos locales al directorio remoto actual arrastrándolos desde el panel local o desde el sistema operativo. Cada archivo MUST añadirse a la cola de transferencias y mostrar su progreso.

#### Scenario: Arrastrar desde el panel local
- **WHEN** el usuario arrastra dos archivos del panel local al panel SFTP
- **THEN** se añaden dos subidas a la cola, se completan con progreso y los archivos aparecen en el directorio remoto

#### Scenario: Sobrescribir un archivo existente
- **WHEN** el usuario sube un archivo con el mismo nombre que uno existente en el directorio remoto
- **THEN** el archivo remoto se reemplaza por el local, igual que en el explorador S3

### Requirement: Descarga de archivos del servidor
El usuario SHALL poder descargar uno o varios archivos remotos arrastrándolos al panel local o con la opción de descargar del menú contextual. Cada archivo MUST añadirse a la cola de transferencias con su progreso.

#### Scenario: Arrastrar al panel local
- **WHEN** el usuario arrastra un archivo del panel SFTP al panel local
- **THEN** se añade una descarga a la cola y, al completarse, el archivo aparece en el directorio local actual

#### Scenario: Descargar con el menú contextual
- **WHEN** el usuario elige "Descargar" en el menú contextual de un archivo remoto y selecciona dónde guardarlo
- **THEN** el archivo se descarga a esa ruta a través de la cola

### Requirement: Gestión de carpetas y borrado remoto
El usuario SHALL poder crear una carpeta en el directorio remoto actual y borrar archivos y carpetas remotos. Borrar una carpeta MUST borrar todo su contenido. La aplicación MUST pedir confirmación antes de borrar.

#### Scenario: Crear carpeta
- **WHEN** el usuario crea la carpeta `backups` en el directorio remoto actual
- **THEN** la carpeta aparece en el listado

#### Scenario: Borrar una carpeta con contenido
- **WHEN** el usuario borra una carpeta remota que contiene archivos y subcarpetas y confirma
- **THEN** la carpeta y todo su contenido desaparecen del servidor

#### Scenario: Cancelar el borrado
- **WHEN** el usuario cancela la confirmación de borrado
- **THEN** no se borra nada

### Requirement: Errores de conexión SFTP
Si no se puede conectar o la conexión se pierde, el panel SFTP SHALL mostrar un error comprensible (host inalcanzable, tiempo de espera agotado, autenticación rechazada) y permitir reintentar. Una transferencia afectada MUST quedar en estado de error en la cola, con opción de reintento.

#### Scenario: Host inalcanzable
- **WHEN** el usuario selecciona una conexión SSH cuyo host no responde
- **THEN** el panel muestra que no se pudo conectar con el servidor y ofrece reintentar

#### Scenario: Conexión perdida durante una transferencia
- **WHEN** la conexión con el servidor se pierde mientras se sube un archivo
- **THEN** la transferencia queda en error en la cola y puede reintentarse cuando el servidor vuelva a estar disponible
