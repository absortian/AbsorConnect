# Prototipos de add-remote-desktop

Pruebas de los puntos de riesgo del grupo 1 de `openspec/changes/add-remote-desktop/tasks.md`. No forman parte de la app ni entran en su paquete. Se borran al terminar el cambio.

| Prueba | Tarea | Qué comprueba |
|---|---|---|
| `input` | 1.3 | `koffi` carga y mueve el ratón con la API nativa (SendInput, CGEvent, XTest). |
| `pbkdf2` | 1.4 | Lo que tarda PBKDF2-HMAC-SHA256 en WebCrypto y en Node. |
| `capture` | 1.1 y 1.2 | Captura de la pantalla principal en una ventana oculta, sin ventana principal, enviada por WebRTC a otra ventana oculta: imágenes por segundo y sonido del sistema. |
| `input-check/` | 4.6 | La inyección de entrada real (`src/main/remote/input`): clics en las esquinas de cada pantalla, teclas por posición, texto Unicode, atajos, doble clic, botones, arrastre y rueda. Ver [más abajo](#prueba-de-entrada-input-check). |
| `input-check/ --mode=support` | 4.7 | El estado del control remoto en el equipo (`src/main/remote/platformSupport.ts`): Wayland en Linux; en macOS, los permisos, sus paneles de Ajustes del Sistema y la notificación de permisos perdidos. |

Al abrirlo sin argumentos se ejecuta todo, y el resultado se guarda en `Descargas/absor-remote-prototype-<sistema>-<arquitectura>-<prueba>.json` (un fichero por prueba) y se muestra en una ventana. Durante la prueba aparece una ventanita en la esquina inferior derecha y suena un pitido suave. El ratón salta unos píxeles al principio y vuelve a su sitio. Nada sale del equipo.

## Ejecutarlo

Con Node en el equipo:

```bash
cd prototypes/remote-desktop
npm install
npx electron@39.8.5 .
npx electron@39.8.5 . --mode=capture --seconds=300 --audio=none
```

Sin Node en Linux, con el contenedor de desarrollo (`bin/dev`): `bin/dev sh -c 'cd prototypes/remote-desktop && npm install'` y, desde la raíz del repo, `node_modules/electron/dist/electron prototypes/remote-desktop`.

Como paquete (lo que pide la tarea 1.3), desde esta carpeta y con `npm install` hecho:

```bash
npx --yes electron-builder@26.15.3 --linux AppImage deb   # en Linux
npx --yes electron-builder@26.15.3 --win nsis             # en Windows
npx --yes electron-builder@26.15.3 --mac dmg              # en macOS
```

En macOS, `./test-mac.sh` genera el DMG la primera vez, lo monta y abre la app desde dentro; `./test-mac.sh capture` hace la captura de 5 minutos. La primera vez hay que conceder **Accesibilidad**, **Grabación de pantalla** y la grabación del sonido del sistema a la app, y volver a ejecutar el script. En la prueba de sonido suena además un sonido del sistema desde otro proceso (`afplay`), por si macOS deja fuera de la captura el de la propia app.

Windows se prueba en una VM de Windows 11 Enterprise Evaluation con [dockur/windows](https://github.com/dockur/windows) (fuera del repo, en `~/VMs/absor-windows`): el instalador NSIS se genera dentro de la VM con Node, como en CI.

## Qué se anota

El JSON resultante se resume en `design.md` (D8, D10 y D12) y en los resultados de cada tarea.

## Prueba de entrada (`input-check/`)

Comprueba la tarea 4.6 con el módulo de la app, no con una copia. Tapa cada pantalla con una ventana, inyecta los eventos con `InputController` y mira lo que le llega a la ventana. Son 14 comprobaciones:

- clics en las esquinas del área de trabajo y en el centro de cada pantalla;
- la tecla a la derecha de la L ("ñ" en español);
- el texto "¿Año 2026? €" y un salto de línea;
- Mayús, una tecla mantenida (sin repetición del sistema) y la repetición del controlador;
- `release-all`, y Ctrl+A y Ctrl+C (Cmd en macOS);
- doble clic, los botones derecho, central, atrás y adelante, arrastre, y rueda vertical y horizontal.

Dura unos 20 segundos, y mientras tanto no hay que tocar el ratón ni el teclado. El resultado sale por la consola y se guarda en `Descargas/absor-input-check-<sistema>-<arquitectura>.json`.

Se compila con esbuild desde la raíz del repo (sin Node en el host: con `bin/dev` delante):

```bash
npx esbuild prototypes/remote-desktop/input-check/main.ts --bundle --platform=node --format=cjs --target=node22 --external:electron --external:koffi --outfile=prototypes/remote-desktop/input-check/out/main.cjs
```

- **Linux:** `node_modules/electron/dist/electron prototypes/remote-desktop/input-check`. Con `--semicolon=";"` si la distribución activa no es la española.
- **Windows:** se copian `package.json`, `target.html` y `out/main.cjs` a una carpeta del equipo, y allí se ejecuta `npm install` y después `npx electron .`. Hay que lanzarlo desde la sesión gráfica: por SSH, con una tarea programada `schtasks /create … /it` y `schtasks /run`.
- **macOS:** `prototypes/remote-desktop/input-check/test-mac.sh`. Instala koffi, Electron y esbuild solo en esa carpeta, compila, ejecuta y deja el JSON en `~/Downloads/absor-input-check-macos.json` y en el portapapeles. Además anota la distribución, el desplazamiento natural y la versión de macOS. Antes de lanzarlo:
  - hay que dar el permiso de **Accesibilidad** a la app desde la que se lanza (Terminal), en Ajustes del Sistema > Privacidad y seguridad. Sin él, la prueba lo apunta en el JSON y se detiene;
  - para la "ñ", la distribución activa debe ser Español.

El JSON se guarda siempre, también cuando algo falla (`error`). `--out=fichero` cambia dónde, y cualquier otro `--clave=valor` se guarda en `args`.

### Modo `support` (tarea 4.7)

`--mode=support` comprueba el estado del control remoto en el equipo, sin tocar el ratón:

- **Linux:** el estado con la sesión actual (`available` en X11, `unsupported` en Wayland) y con una sesión Wayland simulada. Para probar el camino real con el entorno de Wayland: `XDG_SESSION_TYPE=wayland node_modules/electron/dist/electron --ozone-platform=x11 prototypes/remote-desktop/input-check --mode=support`.
- **macOS:** `test-mac.sh support`. Con diálogos, pregunta tres cosas, y cada respuesta queda como una comprobación en `~/Downloads/absor-support-check-macos.json`:
  - si el estado detectado coincide con Ajustes del Sistema;
  - si cada botón abre su panel (Grabación de pantalla y Accesibilidad);
  - si llega la notificación de permisos perdidos.

  Lanzado desde Terminal, los permisos que cuentan son los de Terminal.
