# app-identity Specification

## Purpose

Define cómo se presenta la aplicación al usuario (nombre y marca) y qué identificadores se mantienen entre versiones para que actualizar nunca le haga perder conexiones, credenciales ni ajustes.

## Requirements

### Requirement: Nombre visible de la aplicación
La aplicación SHALL presentarse como "Absor Connect" en todos los puntos visibles para el usuario: título de la ventana, cabecera, pantalla de bienvenida, nombre de la app en el sistema operativo (bundle de macOS, entrada de menú en Linux, atajos y "Aplicaciones instaladas" en Windows) y nombre del instalador o paquete. El nombre MUST ser el mismo en los idiomas en y es.

#### Scenario: Ventana principal
- **WHEN** el usuario abre la aplicación
- **THEN** el título de la ventana y la cabecera muestran "Absor Connect"

#### Scenario: Pantalla de bienvenida sin conexión activa
- **WHEN** el usuario abre la aplicación sin ninguna conexión seleccionada
- **THEN** la bienvenida da la bienvenida a "Absor Connect", tanto con el idioma en inglés como en español

#### Scenario: Nombre en el sistema operativo
- **WHEN** el usuario instala la aplicación en macOS, Windows o Linux
- **THEN** el sistema la muestra como "Absor Connect" (en macOS "Absor Connect.app", en Windows el atajo y la entrada de desinstalación, en Linux la entrada del menú)

#### Scenario: Sin restos del nombre anterior
- **WHEN** se busca "S3 Explorer", "File Explorer" o "Absor Explorer" en los textos visibles de la aplicación, en los nombres de los artefactos de release y en la documentación
- **THEN** no aparece ninguna coincidencia, salvo menciones históricas explícitas como "antes Absor S3 Explorer"

### Requirement: Continuidad de los datos del usuario al actualizar
Al actualizar desde cualquier versión publicada anterior (≤ 0.0.7), la aplicación MUST seguir leyendo los datos que el usuario ya tenía (conexiones, carpetas de conexiones, credenciales cifradas, tema e idioma) sin pedirle ninguna acción.

#### Scenario: Conexiones y credenciales tras actualizar
- **WHEN** un usuario con conexiones guardadas en la v0.0.7 instala la versión renombrada y la abre
- **THEN** ve las mismas conexiones y carpetas, y puede conectarse sin volver a introducir el Access Key ni el Secret Key

#### Scenario: Ajustes tras actualizar
- **WHEN** un usuario que había elegido tema e idioma en la v0.0.7 abre la versión renombrada
- **THEN** la aplicación conserva ese tema y ese idioma

### Requirement: Actualización en el sitio en Windows y Linux
En Windows (instalador) y en Linux (paquetes deb y rpm), instalar la versión renombrada sobre una anterior MUST sustituirla, no instalarse como una aplicación distinta en paralelo.

#### Scenario: Windows sin duplicados
- **WHEN** el usuario ejecuta el instalador de Absor Connect en un Windows con Absor S3 Explorer instalado
- **THEN** "Aplicaciones instaladas" muestra una única entrada, "Absor Connect", y desaparecen los atajos con el nombre anterior

#### Scenario: Paquete Linux actualizado
- **WHEN** el usuario instala el `.deb` o el `.rpm` de Absor Connect en un sistema con la versión anterior instalada
- **THEN** el gestor de paquetes lo trata como una actualización del paquete existente

#### Scenario: macOS con instalación manual
- **WHEN** el usuario de macOS arrastra "Absor Connect.app" a Aplicaciones teniendo instalado "Absor S3 Explorer.app"
- **THEN** ambas apps comparten los mismos datos, y las notas de la release indican que se puede borrar la app antigua
