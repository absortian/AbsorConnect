# Spec Delta

## ADDED Requirements

### Requirement: Instalación silenciosa fiable en Windows
El instalador de Windows SHALL completar la instalación silenciosa (la que usa el auto-update) en las versiones de Windows soportadas, incluidas Windows 11 24H2 y Windows Server 2025, y MUST actualizar en el sitio una instalación existente de una versión anterior.

#### Scenario: Instalación silenciosa repetida en Windows Server 2025
- **WHEN** el instalador se ejecuta en silencio (`/S`) repetidamente en máquinas Windows Server 2025 recién creadas
- **THEN** todas las instalaciones terminan con código 0, dejan la app instalada y no registran fallos de aplicación del instalador

#### Scenario: Actualización sobre una versión instalada con el instalador anterior
- **WHEN** el instalador nuevo se ejecuta en silencio sobre una instalación de la v0.1.0
- **THEN** queda una única entrada "Absor Connect" con la versión nueva
