# Spec Delta

## Purpose

Define cómo se instalan y actualizan las apps móviles de Absor Connect sin cuentas de publicador de Google ni de Apple, y cómo se publican junto con la app de escritorio.

## ADDED Requirements

### Requirement: Instalación en Android sin tienda
Cada versión SHALL publicar un APK firmado siempre con la misma clave propia, descargable desde la web y desde las releases de GitHub. Instalar una versión nueva encima de la anterior MUST conservar la sesión y los datos de la app.

#### Scenario: Primera instalación
- **WHEN** alguien descarga el APK desde la web en un Android y permite instalar apps de esa fuente
- **THEN** la app se instala y abre en la pantalla de acceso

#### Scenario: Actualizar encima
- **WHEN** alguien con la app instalada instala el APK de una versión nueva
- **THEN** Android lo acepta como actualización y la sesión sigue iniciada

### Requirement: Aviso de versión nueva en Android
La app de Android SHALL comprobar al arrancar si hay una release más reciente en GitHub y, si la hay, ofrecer descargar su APK. Si la comprobación falla, MUST seguir funcionando sin avisar.

#### Scenario: Hay una versión nueva
- **WHEN** alguien abre la app y hay una release más reciente
- **THEN** la app muestra un aviso con un botón para descargar el APK nuevo

### Requirement: Instalación en iOS sin cuenta de desarrollador
Cada versión SHALL publicar una `.ipa` sin firmar y mantener una fuente de AltStore/SideStore con la última versión, para que cada persona la instale y la renueve con su propio Apple ID. La web MUST explicar el proceso y sus límites (renovación cada 7 días y máximo de 3 apps con un Apple ID gratuito).

#### Scenario: Añadir la fuente
- **WHEN** alguien añade la fuente de Absor Connect en AltStore o SideStore
- **THEN** ve la app con la última versión y puede instalarla

#### Scenario: Versión nueva en iOS
- **WHEN** se publica una versión nueva
- **THEN** la fuente la anuncia y AltStore/SideStore ofrecen actualizarla

### Requirement: Publicación conjunta
Una release de GitHub (tag `v*`) SHALL publicar a la vez los instaladores de escritorio, el APK, la IPA y la fuente de AltStore, con el mismo número de versión. La publicación de los ficheros móviles MUST NOT alterar los ficheros de auto-update del escritorio.

#### Scenario: Publicar una versión
- **WHEN** se publica el tag `v0.3.0`
- **THEN** la release contiene los instaladores de escritorio, `absor-connect-0.3.0.apk`, `absor-connect-0.3.0.ipa` y la fuente de AltStore con la versión 0.3.0

### Requirement: Descargas móviles en la web
La sección de descargas de la web SHALL incluir Android e iOS con su fichero o fuente de la última versión y los pasos de instalación de cada uno.

#### Scenario: Visita desde un Android
- **WHEN** alguien visita la web desde un Android
- **THEN** la sección de descargas abre la pestaña de Android con el APK de la última versión
