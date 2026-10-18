# app-updates Specification

## Purpose

Define de dónde obtiene la aplicación sus actualizaciones y cómo se garantiza que las instalaciones existentes sigan encontrándolas, incluso tras cambios de nombre del producto o del repositorio.

## Requirements

### Requirement: Origen de las actualizaciones
La aplicación SHALL buscar y descargar actualizaciones desde las releases públicas del repositorio de GitHub `absortian/AbsorConnect`.

#### Scenario: Comprobación desde una versión nueva
- **WHEN** el usuario de una versión renombrada pulsa "Buscar actualizaciones" y hay una release más reciente en `absortian/AbsorConnect`
- **THEN** la aplicación informa de la nueva versión y permite descargarla

### Requirement: Continuidad del auto-update para instalaciones anteriores
Las instalaciones anteriores al renombrado (≤ 0.0.7), configuradas para consultar `absortian/AbsorS3Explorer`, MUST seguir detectando y descargando las nuevas releases publicadas tras el renombrado, sin que el usuario tenga que reinstalar.

#### Scenario: v0.0.7 detecta la versión renombrada
- **WHEN** un usuario con la v0.0.7 en Windows o Linux (AppImage) busca actualizaciones después de publicarse la primera release de Absor Connect
- **THEN** la aplicación detecta la nueva versión, la descarga y la instala

#### Scenario: v0.0.7 en macOS
- **WHEN** un usuario con la v0.0.7 en macOS busca actualizaciones después de publicarse la primera release de Absor Connect
- **THEN** la aplicación detecta la nueva versión y, si no puede instalarla por falta de firma, ofrece el enlace a la página de releases de `absortian/AbsorConnect` (directo o a través de la redirección de GitHub)

### Requirement: Enlace de respaldo a la página de releases
Cuando la comprobación, la descarga o la instalación de una actualización falle, la aplicación SHALL mostrar un enlace a la página de releases del repositorio actual (`https://github.com/absortian/AbsorConnect/releases`) para descargarla manualmente.

#### Scenario: Error al comprobar actualizaciones
- **WHEN** la comprobación de actualizaciones falla (por ejemplo, sin red)
- **THEN** el panel de ajustes muestra el error y un enlace a `https://github.com/absortian/AbsorConnect/releases`

#### Scenario: Error de firma en macOS
- **WHEN** la instalación de una actualización falla por falta de firma de código
- **THEN** la aplicación lo indica y ofrece el enlace a `https://github.com/absortian/AbsorConnect/releases`

### Requirement: Instalación silenciosa fiable en Windows
El instalador de Windows SHALL completar la instalación silenciosa (la que usa el auto-update) en las versiones de Windows soportadas, incluidas Windows 11 24H2 y Windows Server 2025, y MUST actualizar en el sitio una instalación existente de una versión anterior.

#### Scenario: Instalación silenciosa repetida en Windows Server 2025
- **WHEN** el instalador se ejecuta en silencio (`/S`) repetidamente en máquinas Windows Server 2025 recién creadas
- **THEN** todas las instalaciones terminan con código 0, dejan la app instalada y no registran fallos de aplicación del instalador

#### Scenario: Actualización sobre una versión instalada con el instalador anterior
- **WHEN** el instalador nuevo se ejecuta en silencio sobre una instalación de la v0.1.0
- **THEN** queda una única entrada "Absor Connect" con la versión nueva

### Requirement: Actualizaciones con la app en segundo plano
Mientras la app esté en marcha, SHALL buscar actualizaciones al arrancar y cada 6 horas. Si hay una versión nueva, MUST avisar con una notificación del sistema y en el menú de la bandeja, e instalarla al salir de la app si ya se descargó. MUST NOT reiniciarse sola durante una sesión de control remoto.

#### Scenario: Versión nueva con la app en la bandeja
- **WHEN** la app lleva días en segundo plano y se publica una versión nueva
- **THEN** en menos de 6 horas aparece una notificación y el menú de la bandeja ofrece descargarla

#### Scenario: Sesión remota en curso
- **WHEN** una actualización termina de descargarse mientras otro equipo controla este PC
- **THEN** la app no se reinicia y la sesión continúa
