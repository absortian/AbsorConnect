# Spec Delta

## Purpose

Define cómo guarda el servicio en la nube las conexiones y carpetas de cada usuario: aislamiento entre cuentas, cifrado en reposo de los secretos, sincronización entre dispositivos sin perder cambios en silencio y validación de lo que se guarda.

## ADDED Requirements

### Requirement: Conexiones por usuario
Cada cuenta SHALL tener su propia lista de conexiones y carpetas, con los mismos datos que la app gestiona hoy (tipos S3 y SSH, carpetas y orden). Ninguna petición MUST poder leer ni modificar la lista de otra cuenta.

#### Scenario: Leer la lista propia
- **WHEN** una persona con sesión iniciada pide sus conexiones
- **THEN** recibe solo sus conexiones y carpetas, en el orden en que las guardó y con sus credenciales

#### Scenario: Aislamiento entre cuentas
- **WHEN** dos cuentas guardan conexiones con el mismo identificador
- **THEN** cada una ve solo la suya, y guardar en una no altera la otra

### Requirement: Secretos cifrados en reposo
Las claves de acceso S3, las contraseñas SSH y las passphrases SHALL guardarse cifradas en la base de datos con una clave del servicio distinta de `APP_SECRET`. El servicio MUST NOT escribir secretos en claro ni en la base de datos ni en los logs. Las credenciales se transmiten solo por HTTPS.

#### Scenario: Base de datos sin secretos legibles
- **WHEN** se guarda una conexión SSH con contraseña y se inspecciona la tabla de conexiones
- **THEN** la contraseña no aparece en claro en ninguna columna

#### Scenario: Rotación de la clave
- **WHEN** el operador configura una clave nueva y deja la anterior como clave previa
- **THEN** las conexiones existentes se siguen leyendo, y se vuelven a cifrar con la clave nueva cuando se guardan

### Requirement: Secretos ilegibles se conservan
Si el servicio no puede descifrar un secreto guardado (por ejemplo, tras perder la clave), SHALL devolver la conexión con el resto de sus datos marcada como `credentialsUnavailable`, y MUST conservar el secreto guardado mientras el cliente no envíe uno nuevo.

#### Scenario: Clave perdida
- **WHEN** el servicio no puede descifrar los secretos de una conexión y el cliente guarda la lista sin enviar secretos nuevos para ella
- **THEN** la conexión vuelve marcada como `credentialsUnavailable` y su secreto cifrado sigue intacto

### Requirement: Sincronización con revisión
La lista de conexiones de cada cuenta SHALL tener un número de revisión que aumenta con cada guardado. Para guardar, el cliente MUST indicar la revisión sobre la que hizo sus cambios. Si no coincide con la actual, el guardado se rechaza con `connections_conflict` y la respuesta incluye la lista y la revisión actuales.

#### Scenario: Guardado sin conflicto
- **WHEN** un dispositivo guarda su lista indicando la revisión actual
- **THEN** la lista queda reemplazada por la enviada, y la respuesta trae la revisión nueva y la lista guardada

#### Scenario: Cambios desde dos dispositivos
- **WHEN** el dispositivo A guarda sobre la revisión 7 (que pasa a 8) y después el dispositivo B intenta guardar también sobre la 7
- **THEN** el guardado de B se rechaza con `connections_conflict` y recibe la lista de la revisión 8, sin perder los cambios de A

### Requirement: Validación de lo que se guarda
El servicio SHALL rechazar con `connections_invalid` cualquier guardado que contenga entradas no reconocibles: tipo desconocido, campos obligatorios ausentes, puerto fuera de rango, carpetas padre inexistentes, identificadores duplicados o más de 1000 entradas. Un guardado rechazado MUST NOT modificar la lista.

#### Scenario: Entrada con tipo desconocido
- **WHEN** un cliente guarda una lista con una entrada de tipo `ftp`
- **THEN** la respuesta es `connections_invalid`, indica la entrada errónea, y la lista y su revisión no cambian
