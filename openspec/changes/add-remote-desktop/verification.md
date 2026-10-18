# Matriz de la 9.3: control remoto con paquetes reales

Leyenda:
- ✅ verificado con el paquete en el lado que se prueba;
- 🟡 verificado, pero con la app del repo o en un solo equipo;
- ⬜ pendiente;
- ➖ no se puede montar con lo que hay.

Las pruebas y sus resultados detallados están en `design.md` (D8, D10, D11, D12 y D13) y en `prototypes/remote-desktop/README.md`. Paquetes del 18/10/2026 (código de `f0f9662` en adelante), empaquetados como en CI: el AppImage en Linux, el instalador NSIS dentro de la VM de Windows 11 y los `.app` en el Mac.

## Controlador × PC controlado

| Controlador ↓ · PC → | Windows | macOS | Linux X11 |
|---|---|---|---|
| **Windows** | ✅ Instalador → instalador, en dos VM, cada una tras su NAT: por relé, 41/41 aplicables. | ⬜ La VM controla el `.app` de tu Mac por la red local. | ✅ Instalador → AppImage: 44/44 aplicables. |
| **macOS** | ⬜ Tu Mac controla el instalador de la VM. | ➖ Solo hay un Mac. | 🟡 Con la app del repo: `lan-test.sh` (28/30), ficheros, portapapeles, relé con coturn local y sonido de Linux. |
| **Linux** | ✅ PC: instalador. Controlador: app del repo. 42/42. | ✅ PC: `.app` de arm64. Controlador: app del repo. 43/43 aplicables. | 🟡 Con la app del repo en un solo equipo: `lan-check` 40/43 y `viewer-check`. |
| **Android** | ✅ Instalador, por relé (el emulador y la VM están cada uno tras su NAT): 17/17. | ✅ `.app` de x64 con Rosetta: 17/17. | ✅ AppImage: 17/17. |
| **iPhone** | ⬜ | ⬜ | ⬜ |

- **Aplicables:** dos comprobaciones dependen del equipo de prueba y no del paquete:
  - La bandeja:
    - en Windows, la prueba no la lee (se vio a mano en la 4.1);
    - en este Linux, la sesión de Cinnamon no tiene `StatusNotifierWatcher`;
    - en el Mac, System Events no deja leerla.
  - Cortar la red: solo se prueba con el Mac de controlador.
- **Windows → Windows:** "conexión directa en la red local" falla porque las dos VM están tras NAT distintos. La sesión va "Por relé · 1 ms", que es lo esperado ahí.
- **Android:** se probó con el APK de depuración en el emulador, porque `flutter drive` no admite release. La IPA compila en el Mac (7.1), pero no se ha instalado en un iPhone.

## Comprobaciones aparte

| Comprobación | Estado | Detalle |
|---|---|---|
| Al menos una sesión por relé | ✅ | Con paquetes y un coturn local: Android → instalador de Windows (17/17, "Via relay") y Windows → Windows (41/41, "Por relé"). Con el relé de producción, `relay-check` (app del repo, "Por relé · 100 ms · 30 fps"). |
| PC con dos monitores de escalas distintas (clics en las esquinas de cada uno) | 🟡 | Selector de pantallas, 5/5, con el Mac y un iPad por Sidecar, pero los dos al 200 %. Falta un PC con dos escalas. |
| Windows: pista del cortafuegos en Ajustes y aviso al activar (6.2) | ✅ | `package-check/windows-firewall.ts` con el instalador (4/4). Desactivado, no hay pista. Al pulsar el interruptor, Windows pregunta enseguida por "Absor Connect" (`primeFirewall`) y Ajustes muestra la pista de elegir "Permitir". |
| Contraseña local del PC: en disco | ✅ | La contraseña la crea la propia app. No está en claro en ninguno de los 54 ficheros de la carpeta de datos del AppImage ni en los 43 del instalador de Windows. K va cifrada con `safeStorage` (libsecret en Linux, DPAPI en Windows). |
| Contraseña local del PC: en el servicio | ✅ | `password-check` (17/17 en la conexión). Ni la contraseña ni K (base64, base64url, hex) aparecen en el volcado de la base de datos ni en las 82 peticiones a la API: el alta del equipo, las solicitudes, las respuestas SDP y los servidores ICE. Como control, la búsqueda sí encuentra el nombre del PC y el SDP. |
| "Comprobando la contraseña" en un Android modesto y un iPhone (7.2) | ⬜ | Con teléfonos reales. |

## Lo que falta (contigo)

- **iPhone:** instalar la IPA (SideStore, AltStore Classic, o Xcode con tu equipo personal), conectar a un PC de la cuenta y anotar lo que tarda "Comprobando la contraseña". Si tienes un Android modesto, lo mismo con el APK.
- **Dos monitores de escalas distintas:** el Mac con un monitor externo que no sea Retina, o un Windows con dos escalas.
- **macOS ↔ Windows:** tu Mac contra la VM, en los dos sentidos, con el mismo esquema que `package-check`.
- **Por decidir:** la 9.3 pide esta tabla en el PR, pero el cambio va directamente a `main`. Puede quedarse aquí, o ir en el PR de la release conjunta.
