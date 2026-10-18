# Matriz de la 9.3: control remoto con paquetes reales

Leyenda:
- ✅ verificado con el paquete en el lado que se prueba;
- 🟡 verificado, pero con la app del repo o en un solo equipo;
- ⬜ pendiente;
- ➖ no se puede montar con lo que hay.

Las pruebas y sus resultados detallados están en `design.md` (D8, D10, D11, D12 y D13) y en `prototypes/remote-desktop/README.md`.

## Controlador × PC controlado

| Controlador ↓ · PC → | Windows | macOS | Linux X11 |
|---|---|---|---|
| **Windows** | ⬜ Solo hay una VM: los dos papeles en ella (como el ensayo en un solo Linux). | ⬜ La VM controla el `.app` de tu Mac por la red local. | ⬜ La VM controla el AppImage de este Linux. |
| **macOS** | ⬜ Tu Mac controla el instalador de la VM (la sonda, por un túnel abierto a la red local). | ➖ Solo hay un Mac. Como mucho, los dos papeles en el mismo Mac. | 🟡 Con la app del repo: `lan-test.sh` (28/30), ficheros, portapapeles, relé con coturn local y sonido de Linux. |
| **Linux** | ✅ PC: instalador NSIS. Controlador: app del repo. 42/42. | ✅ PC: `.app` de arm64. Controlador: app del repo. 43/43 aplicables. | 🟡 Con la app del repo en un solo equipo: `lan-check` 40/43 y `viewer-check`. |
| **Android** | ⬜ El emulador y la VM están cada uno tras su NAT: necesita el relé. | ✅ PC: `.app` de x64 con Rosetta. 17/17 (APK de depuración en el emulador). | ✅ PC: AppImage. 17/17 (APK de depuración en el emulador). |
| **iPhone** | ⬜ | ⬜ | ⬜ |

- El móvil se ha probado con el APK de depuración en el emulador: `flutter drive` no admite release. La IPA compila en el Mac (7.1), pero no se ha instalado en un iPhone.
- En Linux → Windows y Linux → macOS el controlador era la app del repo. Falta al menos una sesión con el controlador también empaquetado.

## Comprobaciones aparte

| Comprobación | Estado | Detalle |
|---|---|---|
| Al menos una sesión por relé | 🟡 | Con el relé de producción (`relay-check`, "Por relé · 100 ms · 30 fps") y con un coturn local entre el Linux y el Mac, siempre con la app del repo. Falta una con paquetes. |
| PC con dos monitores de escalas distintas (clics en las esquinas de cada uno) | 🟡 | El selector de pantallas, 5/5, con el Mac y un iPad por Sidecar, pero las dos pantallas estaban al 200 %. Falta un PC con dos escalas. |
| Windows: pista del cortafuegos en Ajustes y aviso al activar el control remoto (6.2) | 🟡 | En las pruebas de la 8.1, el instalador dejó las reglas del cortafuegos para `absorconnect.exe`, así que el aviso salió. Falta verlo a propósito: la pista en Ajustes y el aviso al activarlo. |
| Contraseña local del PC: en disco | ⬜ | Buscar la contraseña en la carpeta de datos de un PC empaquetado. |
| Contraseña local del PC: en el servicio | ⬜ | Buscar la contraseña y K en la base de datos y en el tráfico con la API, durante el alta y una conexión. |

## Cómo cubrir lo que falta

**Sin ti** (este Linux, la VM de Windows y el emulador):
1. Contraseña local: los datos del AppImage y del instalador de Windows, un volcado de la base de datos y el tráfico con la API (con un proxy que lo anota) durante el alta y una sesión.
2. Windows: la pista del cortafuegos en Ajustes y el aviso al activar, con capturas. Para que vuelva a salir, primero se quitan de la VM las reglas que dejó la 8.1.
3. Windows como controlador: el instalador de la VM controla el AppImage de este Linux. Así los dos lados van empaquetados.
4. Relé con paquetes: Android → Windows por un coturn local (emulador y VM tras NAT). Cubre a la vez esa celda y la sesión por relé.
5. Windows → Windows: los dos papeles en la VM.

**Contigo:**
- iPhone: instalar la IPA (SideStore, AltStore Classic, o Xcode con tu equipo personal) y conectar a un PC de la cuenta.
- Dos monitores de escalas distintas: el Mac con un monitor externo que no sea Retina, o un Windows con dos escalas.
- macOS ↔ Windows: tu Mac contra la VM, en los dos sentidos, con el mismo esquema que `package-check`.

**Por decidir:** la 9.3 pide esta tabla en el PR, pero el cambio va directamente a `main`. Puede quedarse aquí, o ir en el PR de la release conjunta.
