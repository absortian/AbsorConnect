# Spec Delta

## Purpose

Define las cuentas de usuario del servicio en la nube de Absor Connect: cómo se crean, cómo se inicia y cierra sesión desde cada dispositivo, cómo se cambia la contraseña o se borra la cuenta, y qué protege el registro abierto frente a abusos.

## ADDED Requirements

### Requirement: Registro abierto
Cualquier persona SHALL poder crear una cuenta con un email y una contraseña, sin verificación de email. El email MUST ser único sin distinguir mayúsculas y minúsculas, y la contraseña MUST tener al menos 10 caracteres. Al registrarse, la persona queda con la sesión iniciada en ese dispositivo.

#### Scenario: Registro correcto
- **WHEN** alguien se registra con `Ana@Ejemplo.com` y una contraseña de 12 caracteres
- **THEN** se crea la cuenta con el email `ana@ejemplo.com`, y la respuesta incluye un token de sesión válido

#### Scenario: Email ya registrado
- **WHEN** alguien intenta registrarse con `ANA@ejemplo.com` y ya existe `ana@ejemplo.com`
- **THEN** la respuesta es un error `email_taken` y no se crea ninguna cuenta

#### Scenario: Datos no válidos
- **WHEN** alguien se registra con un email mal formado o con una contraseña de menos de 10 caracteres
- **THEN** la respuesta es un error `email_invalid` o `password_too_short`, y no se crea nada

### Requirement: Inicio de sesión por dispositivo
Una persona registrada SHALL poder iniciar sesión con su email y contraseña desde cualquier dispositivo. Cada inicio crea una sesión independiente, identificada por un token opaco que el servidor guarda solo como hash. La sesión caduca tras 90 días sin uso.

#### Scenario: Credenciales correctas
- **WHEN** alguien inicia sesión con su email y contraseña correctos indicando el nombre del dispositivo
- **THEN** recibe un token de sesión, y las peticiones con ese token se atribuyen a su cuenta

#### Scenario: Credenciales incorrectas
- **WHEN** alguien inicia sesión con una contraseña incorrecta o un email que no existe
- **THEN** la respuesta es el mismo error `invalid_credentials` en los dos casos, sin revelar si el email existe

#### Scenario: Sesión caducada o desconocida
- **WHEN** se llama a la API con un token caducado, revocado o inexistente
- **THEN** la respuesta es un error 401 `unauthenticated`

### Requirement: Cierre de sesión
Una persona SHALL poder cerrar la sesión del dispositivo actual, lo que revoca su token, sin afectar a sus otras sesiones.

#### Scenario: Cerrar sesión en un dispositivo
- **WHEN** alguien con sesiones en dos dispositivos cierra sesión en uno
- **THEN** el token de ese dispositivo deja de ser válido y el del otro sigue funcionando

### Requirement: Cambio de contraseña
Una persona con sesión iniciada SHALL poder cambiar su contraseña indicando la actual. El cambio MUST revocar todas sus demás sesiones y conservar la actual.

#### Scenario: Cambio correcto
- **WHEN** alguien cambia su contraseña indicando la actual correcta
- **THEN** la contraseña nueva funciona para iniciar sesión, la anterior no, y sus otras sesiones quedan revocadas

#### Scenario: Contraseña actual incorrecta
- **WHEN** alguien intenta cambiar su contraseña con una contraseña actual incorrecta
- **THEN** la respuesta es un error `password_incorrect` y no cambia nada

### Requirement: Borrado de la cuenta
Una persona con sesión iniciada SHALL poder borrar su cuenta confirmando su contraseña. El borrado MUST eliminar la cuenta, todas sus sesiones y todas sus conexiones.

#### Scenario: Borrar la cuenta
- **WHEN** alguien borra su cuenta con su contraseña correcta
- **THEN** no queda ningún dato suyo en el servicio, y su email puede volver a registrarse

### Requirement: Restablecimiento por el operador
Como no hay recuperación por correo, el operador del servicio SHALL poder restablecer la contraseña de una cuenta desde la consola del servidor. El restablecimiento MUST revocar todas las sesiones de esa cuenta y conservar sus conexiones.

#### Scenario: Restablecer una contraseña olvidada
- **WHEN** el operador ejecuta el comando de restablecimiento para `ana@ejemplo.com`
- **THEN** obtiene una contraseña nueva para comunicársela a la persona, las sesiones de esa cuenta quedan revocadas y sus conexiones siguen intactas

### Requirement: Límites contra abusos
El servicio SHALL limitar los intentos de registro por dirección IP y los intentos de inicio de sesión por IP y por email. Los límites MUST aplicarse en conjunto para todas las réplicas del servicio.

#### Scenario: Demasiados intentos de inicio de sesión
- **WHEN** se hacen más de 5 intentos fallidos de inicio de sesión para el mismo email en un minuto
- **THEN** los siguientes intentos responden `too_many_attempts` (429), aunque lleguen a réplicas distintas

#### Scenario: Registro masivo desde una IP
- **WHEN** una misma IP intenta crear más de 5 cuentas en una hora
- **THEN** los siguientes registros responden `too_many_attempts` (429)
