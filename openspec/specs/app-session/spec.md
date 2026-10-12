# app-session Specification

## Purpose
Define cómo se usa la aplicación con una cuenta del servicio en la nube: acceso obligatorio, inicio de sesión y registro, sesión recordada en cada equipo, cierre y caducidad de la sesión, gestión de la cuenta y qué pasa cuando el servicio no está disponible.

## Requirements

### Requirement: Acceso obligatorio
Sin una sesión válida, la aplicación SHALL mostrar únicamente la pantalla de acceso (iniciar sesión o crear cuenta) y MUST NOT mostrar ni usar ninguna conexión.

#### Scenario: Primer arranque
- **WHEN** alguien abre la aplicación sin haber iniciado sesión nunca en ese equipo
- **THEN** ve la pantalla de acceso y no ve la barra de conexiones ni el explorador

#### Scenario: Crear cuenta desde la app
- **WHEN** alguien elige "Crear cuenta", introduce un email y una contraseña válidos y confirma
- **THEN** se crea la cuenta, queda con la sesión iniciada y entra en la aplicación con su lista de conexiones (vacía, si es nueva)

#### Scenario: Errores de acceso comprensibles
- **WHEN** el servicio rechaza el acceso por credenciales incorrectas, email ya registrado, contraseña demasiado corta o demasiados intentos
- **THEN** la pantalla de acceso muestra un mensaje específico de cada caso, en el idioma de la aplicación

### Requirement: Sesión recordada en el equipo
Tras iniciar sesión, la aplicación SHALL recordar la sesión en ese equipo entre reinicios. El token de sesión MUST guardarse cifrado con el almacén seguro del sistema cuando exista. Si no existe, se guarda sin cifrar y Ajustes lo indica.

#### Scenario: Reiniciar la aplicación
- **WHEN** alguien con la sesión iniciada cierra y vuelve a abrir la aplicación
- **THEN** entra directamente con sus conexiones, sin volver a introducir la contraseña

#### Scenario: Token en disco
- **WHEN** se inspecciona la carpeta de datos de la aplicación en un sistema con almacén seguro
- **THEN** el token de sesión no aparece en claro en ningún fichero

### Requirement: Cierre y caducidad de la sesión
La aplicación SHALL permitir cerrar la sesión desde Ajustes. Al cerrarla o al detectar que la sesión ya no es válida, MUST revocarla (si aún es válida), borrar el token y las conexiones de memoria, cerrar las conexiones SSH y terminales abiertas y volver a la pantalla de acceso.

#### Scenario: Cerrar sesión
- **WHEN** alguien pulsa "Cerrar sesión" en Ajustes
- **THEN** vuelve a la pantalla de acceso, sus terminales se cierran y al reabrir la aplicación se le pide iniciar sesión

#### Scenario: Sesión revocada desde otro lugar
- **WHEN** la sesión del equipo deja de ser válida (cambio de contraseña en otro equipo, restablecimiento por el operador o caducidad)
- **THEN** en la siguiente operación con el servicio la aplicación vuelve a la pantalla de acceso con un aviso de que hay que iniciar sesión de nuevo

### Requirement: Gestión de la cuenta
Ajustes SHALL mostrar el email de la cuenta y permitir cambiar la contraseña (indicando la actual) y borrar la cuenta (confirmando con la contraseña y tras un aviso de que se borrarán todas las conexiones).

#### Scenario: Cambiar la contraseña
- **WHEN** alguien cambia su contraseña desde Ajustes con la actual correcta
- **THEN** la aplicación confirma el cambio y sigue con la sesión iniciada en ese equipo

#### Scenario: Borrar la cuenta
- **WHEN** alguien borra su cuenta desde Ajustes, confirma el aviso e introduce su contraseña
- **THEN** la cuenta y sus conexiones desaparecen del servicio y la aplicación vuelve a la pantalla de acceso

### Requirement: Servicio no disponible
Si el servicio no responde, la aplicación SHALL mostrar un error comprensible con la opción de reintentar, sin perder la sesión guardada.

#### Scenario: Sin conexión a internet al arrancar
- **WHEN** alguien con la sesión iniciada abre la aplicación sin conexión a internet
- **THEN** ve un aviso de que no se puede contactar con el servicio y un botón "Reintentar"; al recuperar la conexión y reintentar, entra con sus conexiones

### Requirement: Cambios desde otros equipos
La aplicación SHALL mostrar los cambios hechos desde otros equipos de la misma cuenta: al volver a la ventana tras al menos 30 segundos fuera, y cuando un guardado se rechaza por conflicto. En el segundo caso MUST recargar la lista y avisar de que el último cambio no se guardó.

#### Scenario: Conexión creada en otro equipo
- **WHEN** alguien crea una conexión en el equipo A y vuelve a la ventana de la aplicación en el equipo B
- **THEN** la conexión aparece en la lista del equipo B

#### Scenario: Conflicto al guardar
- **WHEN** el equipo B guarda un cambio sobre una lista que el equipo A modificó después de la última recarga de B
- **THEN** B muestra la lista actual (con el cambio de A) y un aviso de que su último cambio no se guardó y debe repetirlo
