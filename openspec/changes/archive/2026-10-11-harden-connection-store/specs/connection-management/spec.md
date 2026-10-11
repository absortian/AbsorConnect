# Spec Delta

## MODIFIED Requirements

### Requirement: Protección de secretos
Los secretos de cualquier tipo de conexión (claves de acceso S3, contraseña SSH y passphrase) MUST guardarse cifrados en disco con el mismo mecanismo que las credenciales S3. La aplicación MUST NOT copiar a su almacenamiento el contenido de las claves privadas, solo su ruta. Si el sistema no ofrece almacén seguro, los secretos se guardan sin cifrar, MUST NOT marcarse como cifrados y la aplicación MUST informar de ello al usuario.

#### Scenario: Contraseña SSH en disco
- **WHEN** el usuario guarda una conexión SSH con contraseña en un sistema con cifrado disponible
- **THEN** el fichero de conexiones no contiene la contraseña en claro

#### Scenario: Clave privada referenciada
- **WHEN** el usuario guarda una conexión SSH con clave privada
- **THEN** el fichero de conexiones contiene la ruta de la clave y no su contenido

#### Scenario: Sistema sin almacén seguro
- **WHEN** el usuario guarda conexiones en un sistema sin almacén seguro (por ejemplo, Linux sin keyring)
- **THEN** los secretos se guardan sin la marca de cifrado y Ajustes indica que las credenciales se guardan sin cifrar en este sistema

## ADDED Requirements

### Requirement: Credenciales ilegibles se conservan
Si un secreto guardado no se puede descifrar, la aplicación SHALL mostrar igualmente la conexión con el resto de sus datos, marcada como "credenciales no disponibles", y MUST NOT eliminar ni sobrescribir el secreto guardado hasta que el usuario introduzca uno nuevo.

#### Scenario: Clave de cifrado del sistema perdida
- **WHEN** la aplicación arranca y no puede descifrar las credenciales de una conexión
- **THEN** la conexión aparece en la lista con un aviso de credenciales no disponibles, junto al resto de conexiones

#### Scenario: Guardar otros cambios no borra el secreto ilegible
- **WHEN** hay una conexión con credenciales no disponibles y el usuario crea, mueve o renombra cualquier conexión
- **THEN** el secreto ilegible sigue intacto en disco

#### Scenario: Volver a introducir las credenciales
- **WHEN** el usuario edita la conexión afectada e introduce credenciales nuevas
- **THEN** se guardan cifradas, desaparece el aviso y la conexión vuelve a funcionar

### Requirement: Fichero de conexiones dañado
Si el fichero de conexiones existe pero no se puede interpretar, la aplicación SHALL apartarlo a una copia con fecha antes de escribir nada y SHALL avisar al usuario indicando dónde está la copia. Nunca MUST sobrescribirlo en silencio.

#### Scenario: JSON corrupto
- **WHEN** `connections.json` contiene datos que no son JSON válido y el usuario abre la aplicación
- **THEN** el fichero se conserva como `connections.json.corrupt-<fecha>`, la barra lateral muestra un aviso con esa ruta y las conexiones nuevas se guardan sin tocar la copia

### Requirement: Secretos guardados en claro por versiones anteriores
Los secretos que versiones anteriores guardaron sin cifrar (estén o no marcados como cifrados) SHALL leerse correctamente, y MUST quedar cifrados en el siguiente guardado si el sistema dispone de almacén seguro.

#### Scenario: Secreto en claro marcado como cifrado
- **WHEN** el fichero contiene una conexión con `_encrypted: true` cuyos secretos están en claro (guardados en un sistema sin almacén seguro)
- **THEN** la conexión se carga con sus credenciales correctas

#### Scenario: Cifrado al aparecer el almacén seguro
- **WHEN** ese mismo fichero se usa en un sistema con almacén seguro y el usuario guarda cualquier cambio
- **THEN** los secretos quedan cifrados en disco
