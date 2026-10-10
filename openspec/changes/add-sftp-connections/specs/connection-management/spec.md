# Spec Delta

## Purpose

Define qué tipos de conexión remota gestiona la aplicación (S3 y SSH), qué datos guarda de cada una, cómo protege sus secretos y cómo se conservan e intercambian las conexiones entre versiones e instalaciones.

## ADDED Requirements

### Requirement: Tipos de conexión
La aplicación SHALL permitir crear y editar conexiones de tipo **S3** y de tipo **SSH**. El formulario MUST mostrar solo los campos del tipo elegido, y la lista de conexiones MUST distinguir visualmente el tipo de cada una.

#### Scenario: Crear una conexión SSH
- **WHEN** el usuario crea una conexión, elige el tipo SSH y rellena nombre, host, usuario y contraseña
- **THEN** la conexión aparece en la lista con un indicador de tipo SSH y el puerto 22 por defecto

#### Scenario: Cambiar de tipo en el formulario
- **WHEN** el usuario cambia el tipo de S3 a SSH en el formulario de una conexión nueva
- **THEN** el formulario oculta endpoint, región, claves de acceso y bucket, y muestra host, puerto, usuario, método de autenticación y directorio inicial

#### Scenario: Campos obligatorios de SSH
- **WHEN** el usuario intenta guardar una conexión SSH sin host o sin usuario
- **THEN** el formulario no se envía e indica los campos que faltan

### Requirement: Autenticación de conexiones SSH
Una conexión SSH SHALL autenticarse con uno de dos métodos: contraseña, o clave privada indicada por la ruta de un fichero local con passphrase opcional. Con contraseña, la aplicación MUST aceptar también servidores que la pidan por keyboard-interactive.

#### Scenario: Autenticación por contraseña
- **WHEN** el usuario se conecta a un servidor SSH con usuario y contraseña correctos
- **THEN** la conexión se establece

#### Scenario: Autenticación por clave privada con passphrase
- **WHEN** el usuario configura una ruta a una clave privada cifrada y su passphrase, y se conecta
- **THEN** la conexión se establece usando esa clave

#### Scenario: Clave privada no encontrada
- **WHEN** la ruta de la clave privada no existe o no se puede leer
- **THEN** la aplicación muestra un error que indica que no se pudo leer la clave en esa ruta y no intenta otros métodos

#### Scenario: Credenciales rechazadas
- **WHEN** el servidor rechaza la autenticación
- **THEN** la aplicación muestra un error de autenticación distinto de los errores de red

### Requirement: Protección de secretos
Los secretos de cualquier tipo de conexión (claves de acceso S3, contraseña SSH y passphrase) MUST guardarse cifrados en disco con el mismo mecanismo que las credenciales S3. La aplicación MUST NOT copiar a su almacenamiento el contenido de las claves privadas, solo su ruta.

#### Scenario: Contraseña SSH en disco
- **WHEN** el usuario guarda una conexión SSH con contraseña en un sistema con cifrado disponible
- **THEN** el fichero de conexiones no contiene la contraseña en claro

#### Scenario: Clave privada referenciada
- **WHEN** el usuario guarda una conexión SSH con clave privada
- **THEN** el fichero de conexiones contiene la ruta de la clave y no su contenido

### Requirement: Compatibilidad con conexiones existentes
Las conexiones guardadas o exportadas por versiones anteriores, que no indican tipo, MUST tratarse como conexiones S3 y conservar todos sus datos y credenciales.

#### Scenario: Actualizar con conexiones S3 guardadas
- **WHEN** un usuario con conexiones S3 creadas en una versión anterior abre la versión con SSH
- **THEN** ve las mismas conexiones como S3 y puede usarlas sin cambios

#### Scenario: Importar una exportación antigua
- **WHEN** el usuario importa un fichero de conexiones exportado por una versión anterior
- **THEN** todas sus entradas se importan como conexiones S3

### Requirement: Exportación e importación con tipo
La exportación SHALL incluir el tipo y todos los campos de cada conexión, y la importación MUST restaurarlos. La importación MUST rechazar un fichero cuyas entradas no sean conexiones o carpetas reconocibles, sin modificar las conexiones actuales.

#### Scenario: Ida y vuelta de una conexión SSH
- **WHEN** el usuario exporta conexiones que incluyen una SSH y luego importa ese fichero
- **THEN** la conexión SSH se restaura con su host, puerto, usuario, método de autenticación y secretos

#### Scenario: Fichero no válido
- **WHEN** el usuario importa un JSON con entradas de un tipo desconocido
- **THEN** la aplicación muestra un error de importación y las conexiones actuales no cambian
