# Spec Delta

## MODIFIED Requirements

### Requirement: Compatibilidad con conexiones existentes
Las conexiones guardadas o exportadas por versiones anteriores, que no indican tipo, MUST tratarse como conexiones S3 y conservar todos sus datos y credenciales, tanto al migrarlas desde el equipo como al importarlas.

#### Scenario: Actualizar con conexiones S3 guardadas
- **WHEN** un usuario con conexiones S3 creadas en una versión anterior actualiza, inicia sesión y acepta subir sus conexiones locales
- **THEN** ve las mismas conexiones como S3 en su cuenta y puede usarlas sin cambios

#### Scenario: Importar una exportación antigua
- **WHEN** el usuario importa un fichero de conexiones exportado por una versión anterior
- **THEN** todas sus entradas se importan a su cuenta como conexiones S3

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

## ADDED Requirements

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

## REMOVED Requirements

### Requirement: Protección de secretos
**Reason**: Los secretos ya no se guardan en el equipo, sino en el servicio en la nube, cifrados en reposo (`cloud-connections`, requisito "Secretos cifrados en reposo").
**Migration**: Lo que se garantizaba en local lo cubren ahora "Credenciales fuera del equipo" (nada de secretos en disco y solo la ruta de las claves privadas) y `cloud-connections` (cifrado en el servicio).

### Requirement: Fichero de conexiones dañado
**Reason**: El fichero local deja de ser el almacén de las conexiones; solo se lee una vez para migrarlo.
**Migration**: El tratamiento de un fichero dañado pasa al escenario "Fichero local dañado" de "Migración de las conexiones locales".

### Requirement: Secretos guardados en claro por versiones anteriores
**Reason**: Ya no se cifra nada en el disco del equipo; los secretos heredados solo se leen para subirlos.
**Migration**: La lectura de secretos en claro marcados como cifrados pasa al escenario "Secretos locales en claro o ilegibles" de "Migración de las conexiones locales".
