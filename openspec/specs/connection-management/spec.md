# connection-management Specification

## Purpose

Define qué tipos de conexión remota gestiona la aplicación (S3 y SSH), qué datos guarda de cada una, cómo protege sus secretos y cómo se conservan e intercambian las conexiones entre versiones e instalaciones.

## Requirements

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

### Requirement: Compatibilidad con conexiones existentes
Las conexiones guardadas o exportadas por versiones anteriores, que no indican tipo, MUST tratarse como conexiones S3 y conservar todos sus datos y credenciales, tanto al migrarlas desde el equipo como al importarlas.

#### Scenario: Actualizar con conexiones S3 guardadas
- **WHEN** un usuario con conexiones S3 creadas en una versión anterior actualiza, inicia sesión y acepta subir sus conexiones locales
- **THEN** ve las mismas conexiones como S3 en su cuenta y puede usarlas sin cambios

#### Scenario: Importar una exportación antigua
- **WHEN** el usuario importa un fichero de conexiones exportado por una versión anterior
- **THEN** todas sus entradas se importan a su cuenta como conexiones S3

### Requirement: Exportación e importación con tipo
La exportación SHALL incluir el tipo y todos los campos de cada conexión, y la importación MUST restaurarlos. La importación MUST rechazar un fichero cuyas entradas no sean conexiones o carpetas reconocibles, sin modificar las conexiones actuales.

#### Scenario: Ida y vuelta de una conexión SSH
- **WHEN** el usuario exporta conexiones que incluyen una SSH y luego importa ese fichero
- **THEN** la conexión SSH se restaura con su host, puerto, usuario, método de autenticación y secretos

#### Scenario: Fichero no válido
- **WHEN** el usuario importa un JSON con entradas de un tipo desconocido
- **THEN** la aplicación muestra un error de importación y las conexiones actuales no cambian

### Requirement: Credenciales ilegibles se conservan
Si un secreto guardado no se puede descifrar, la aplicación SHALL mostrar igualmente la conexión con el resto de sus datos, marcada como "credenciales no disponibles", y MUST NOT eliminar ni sobrescribir el secreto guardado hasta que el usuario introduzca uno nuevo.

#### Scenario: Clave de cifrado del sistema perdida
- **WHEN** el servicio no puede descifrar las credenciales de una conexión de la cuenta
- **THEN** la conexión aparece en la lista con un aviso de credenciales no disponibles, junto al resto de conexiones

#### Scenario: Guardar otros cambios no borra el secreto ilegible
- **WHEN** hay una conexión con credenciales no disponibles y el usuario crea, mueve o renombra cualquier conexión
- **THEN** el secreto ilegible sigue intacto en el servicio

#### Scenario: Volver a introducir las credenciales
- **WHEN** el usuario edita la conexión afectada e introduce credenciales nuevas
- **THEN** se guardan, desaparece el aviso y la conexión vuelve a funcionar

### Requirement: Credenciales fuera del equipo
Las conexiones y sus credenciales SHALL guardarse en la cuenta del servicio en la nube y no en el disco del equipo. La aplicación MUST NOT escribir secretos de conexión en ningún fichero local, salvo el fichero de versiones anteriores que ya existiera hasta que se migre. De las claves privadas solo se guarda la ruta, nunca su contenido.

#### Scenario: Contraseña SSH guardada
- **WHEN** el usuario guarda una conexión SSH con contraseña
- **THEN** la conexión queda en su cuenta, y en la carpeta de datos de la aplicación no se crea ni modifica ningún fichero de conexiones

#### Scenario: Clave privada referenciada
- **WHEN** el usuario guarda una conexión SSH con clave privada
- **THEN** la cuenta guarda la ruta de la clave y no su contenido

### Requirement: Migración de las conexiones locales
Tras iniciar sesión en un equipo que tenga el fichero de conexiones de una versión anterior con alguna entrada legible, la aplicación SHALL preguntar si subirlas a la cuenta. Si se acepta, MUST añadirlas a las de la cuenta (sin duplicar las que ya estén por identificador) y, solo tras confirmarse el guardado, borrar el fichero local y su copia `.bak`. Si se rechaza, el fichero se conserva y se vuelve a preguntar en el siguiente inicio de sesión.

#### Scenario: Subir las conexiones del equipo
- **WHEN** un usuario con 3 conexiones locales inicia sesión y acepta subirlas
- **THEN** las 3 aparecen en su cuenta junto a las que ya tuviera, y `connections.json` y `connections.json.bak` ya no existen en el equipo

#### Scenario: Aplazar la migración
- **WHEN** el usuario elige "Ahora no"
- **THEN** el fichero local sigue intacto, no se sube nada, y en el siguiente inicio de sesión se le vuelve a preguntar

#### Scenario: Fallo al subir
- **WHEN** la subida falla (servicio no disponible o conflicto)
- **THEN** el fichero local no se borra y la aplicación indica que no se pudo completar la migración

#### Scenario: Fichero local dañado
- **WHEN** el fichero local no es JSON válido
- **THEN** se aparta a `connections.json.corrupt-<fecha>`, no se ofrece la migración y la aplicación indica dónde está la copia

#### Scenario: Secretos locales en claro o ilegibles
- **WHEN** el fichero local contiene secretos en claro marcados como cifrados, o secretos que el equipo ya no puede descifrar
- **THEN** los primeros se suben con sus credenciales correctas y los segundos se suben sin secreto, marcados para volver a introducirlos
