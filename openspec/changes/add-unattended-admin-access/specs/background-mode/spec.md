# Spec Delta

## MODIFIED Requirements

### Requirement: Icono en la bandeja del sistema
Mientras la app está en marcha SHALL mostrar un icono en la bandeja del sistema (barra de menús en macOS) con un menú para abrir la ventana, ver el estado del control remoto de ese PC (desactivado, disponible o con una sesión activa) y salir de la interfaz. Con acceso desatendido activo, el menú MUST indicar que el servicio seguirá disponible y ofrecer una acción separada para detener todo el acceso remoto.

#### Scenario: Abrir desde la bandeja
- **WHEN** la app está en marcha sin ventana y alguien elige "Abrir Absor Connect" en el menú del icono
- **THEN** aparece la ventana principal en el estado en que estaba

#### Scenario: Salir desde la bandeja
- **WHEN** alguien elige "Salir" en el menú del icono
- **THEN** sin agente desatendido la app cierra sus conexiones SSH y sus sesiones remotas y termina por completo; con agente activo cierra la interfaz y las sesiones como controlador, manteniendo el host y avisando de ello

#### Scenario: Estado del control remoto
- **WHEN** alguien controla este PC en remoto
- **THEN** el icono y su menú indican que hay una sesión activa y desde qué equipo

#### Scenario: Detener el acceso remoto
- **WHEN** el propietario elige detener todo el acceso remoto
- **THEN** se termina la sesión como host y el servicio deja de aceptar conexiones hasta su reactivación explícita

## ADDED Requirements

### Requirement: Un solo host entre app y agente
La interfaz y el agente SHALL representar el mismo equipo y MUST NOT atender en paralelo solicitudes remotas ni duplicar su registro. Reiniciar la interfaz MUST NOT interrumpir el host desatendido. La interfaz MUST mostrar el estado real del servicio, incluido cuando no puede comunicarse con él.

#### Scenario: Abrir la app con agente activo
- **WHEN** el propietario abre Electron durante una sesión atendida por el agente
- **THEN** ve el mismo equipo ocupado y la sesión continúa sin otro registro ni otra captura
