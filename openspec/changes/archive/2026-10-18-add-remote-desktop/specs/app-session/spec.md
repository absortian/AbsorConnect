# Spec Delta

## MODIFIED Requirements

### Requirement: Cierre y caducidad de la sesión
La aplicación SHALL permitir cerrar la sesión desde Ajustes. Al cerrarla o al detectar que la sesión ya no es válida, MUST revocarla (si aún es válida), borrar el token y las conexiones de memoria, cerrar las conexiones SSH y terminales abiertas, cerrar las sesiones de control remoto (como controlador y como equipo controlado), dejar el PC sin control remoto y volver a la pantalla de acceso.

#### Scenario: Cerrar sesión
- **WHEN** alguien pulsa "Cerrar sesión" en Ajustes
- **THEN** vuelve a la pantalla de acceso, sus terminales se cierran y al reabrir la aplicación se le pide iniciar sesión

#### Scenario: Sesión revocada desde otro lugar
- **WHEN** la sesión del equipo deja de ser válida (cambio de contraseña en otro equipo, restablecimiento por el operador o caducidad)
- **THEN** en la siguiente operación con el servicio la aplicación vuelve a la pantalla de acceso con un aviso de que hay que iniciar sesión de nuevo

#### Scenario: Cerrar sesión con el control remoto activado
- **WHEN** alguien cierra la sesión mientras otro equipo controla este PC
- **THEN** la sesión de control remoto termina y el PC deja de aparecer como disponible en la cuenta

#### Scenario: Sesión caducada en un PC en segundo plano
- **WHEN** la sesión de un PC con el control remoto activado deja de ser válida mientras la app está en la bandeja
- **THEN** el PC deja de estar disponible y la app muestra una notificación de que hay que volver a iniciar sesión
