# desktop-distribution Specification

## Purpose
Cómo se instala y se abre por primera vez la app de escritorio descargada de la web, sin certificados de Apple ni de Microsoft.

## Requirements

### Requirement: Apertura en macOS sin certificado de Apple
La app de macOS SHALL publicarse con una firma de código válida aunque no tenga certificado de Apple, para que macOS la trate como una app sin verificar y no como una app dañada. La web MUST explicar cómo abrirla la primera vez.

#### Scenario: Primera apertura de una descarga
- **WHEN** alguien descarga el `.dmg` o el `.zip` de macOS desde la web, copia la app en Aplicaciones y la abre
- **THEN** macOS avisa de que no puede verificarla y permite abrirla desde Ajustes del Sistema › Privacidad y seguridad › Abrir igualmente, sin decir que está dañada

#### Scenario: Firma comprobable
- **WHEN** se comprueba la firma de la app publicada con `codesign --verify --deep --strict`
- **THEN** la firma es válida y cumple su requisito designado

#### Scenario: Versiones anteriores dañadas
- **WHEN** alguien con una versión hasta la 0.3.1 ve el mensaje «está dañada»
- **THEN** la web le da el comando de Terminal que permite abrirla
