# Spec Delta

## Purpose

Permite que la app de escritorio siga en marcha sin ventana abierta (en la bandeja del sistema o la barra de menús) y que se abra al iniciar sesión en el sistema, para que un PC pueda estar disponible para el control remoto sin que nadie la tenga abierta.

## ADDED Requirements

### Requirement: Icono en la bandeja del sistema
Mientras la app está en marcha SHALL mostrar un icono en la bandeja del sistema (barra de menús en macOS) con un menú para abrir la ventana, ver el estado del control remoto de ese PC (desactivado, disponible o con una sesión activa) y salir de la app.

#### Scenario: Abrir desde la bandeja
- **WHEN** la app está en marcha sin ventana y alguien elige "Abrir Absor Connect" en el menú del icono
- **THEN** aparece la ventana principal en el estado en que estaba

#### Scenario: Salir desde la bandeja
- **WHEN** alguien elige "Salir" en el menú del icono
- **THEN** la app cierra sus conexiones SSH y sus sesiones de control remoto, y termina por completo

#### Scenario: Estado del control remoto
- **WHEN** alguien controla este PC en remoto
- **THEN** el icono y su menú indican que hay una sesión activa y desde qué equipo

### Requirement: Mantener abierta al cerrar la ventana
Ajustes SHALL ofrecer la opción "Mantener abierta en segundo plano", desactivada por defecto. Con la opción activada, cerrar la ventana MUST ocultarla sin terminar la app. Con la opción desactivada, cerrar la ventana se comporta como hasta ahora.

#### Scenario: Comportamiento por defecto
- **WHEN** alguien que nunca ha cambiado la opción cierra la ventana en Windows o Linux
- **THEN** la app termina, como en versiones anteriores

#### Scenario: Cerrar con la opción activada
- **WHEN** alguien con la opción activada cierra la ventana
- **THEN** la ventana desaparece, el icono sigue en la bandeja y el PC sigue disponible para el control remoto si lo tiene activado

### Requirement: Abrir al iniciar sesión en el sistema
Ajustes SHALL ofrecer la opción "Abrir al iniciar sesión", desactivada por defecto, en Windows, macOS y Linux. Con ella activada, la app MUST arrancar al iniciar sesión en el sistema sin mostrar la ventana, solo con el icono de la bandeja.

#### Scenario: Arranque del sistema
- **WHEN** alguien con la opción activada reinicia el PC e inicia sesión en el sistema
- **THEN** la app queda en marcha en la bandeja sin abrir su ventana

#### Scenario: Desactivar la opción
- **WHEN** alguien desactiva la opción y reinicia el PC
- **THEN** la app no arranca sola

### Requirement: Una sola instancia
Solo SHALL haber una instancia de la app en marcha por usuario del sistema. Abrir la app cuando ya está en marcha MUST mostrar la ventana de la instancia existente en lugar de arrancar otra.

#### Scenario: Abrir la app otra vez
- **WHEN** la app está en marcha en segundo plano y alguien la abre desde el menú de aplicaciones
- **THEN** aparece la ventana de la instancia que ya estaba en marcha y no se inicia un segundo proceso

#### Scenario: Escritorio sin bandeja del sistema
- **WHEN** el escritorio de Linux no muestra iconos de bandeja y la app está en segundo plano
- **THEN** abrir la app desde el menú de aplicaciones muestra su ventana
