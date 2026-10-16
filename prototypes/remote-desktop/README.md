# Prototipos de add-remote-desktop

Pruebas de los puntos de riesgo del grupo 1 de `openspec/changes/add-remote-desktop/tasks.md`. No forman parte de la app ni entran en su paquete. Se borran al terminar el cambio.

| Prueba | Tarea | Qué comprueba |
|---|---|---|
| `input` | 1.3 | `koffi` carga y mueve el ratón con la API nativa (SendInput, CGEvent, XTest). |
| `pbkdf2` | 1.4 | Lo que tarda PBKDF2-HMAC-SHA256 en WebCrypto y en Node. |
| `capture` | 1.1 y 1.2 | Captura de la pantalla principal en una ventana oculta, sin ventana principal, enviada por WebRTC a otra ventana oculta: imágenes por segundo y sonido del sistema. |
| `input-check/` | 4.6 | La inyección de entrada real (`src/main/remote/input`): clics en las esquinas de cada pantalla, teclas por posición, texto Unicode, atajos, doble clic, botones, arrastre y rueda. Ver [más abajo](#prueba-de-entrada-input-check). |
| `input-check/ --mode=support` | 4.7 | El estado del control remoto en el equipo (`src/main/remote/platformSupport.ts`): Wayland en Linux; en macOS, los permisos, sus paneles de Ajustes del Sistema y la notificación de permisos perdidos. |
| `input-check/test-mac.sh background` | 4.1 y 4.2 | La app empaquetada en macOS (AbsorCheck.app): barra de menús y su menú, Dock, cerrar a la bandeja, instancia única, arranque oculto, abrir al iniciar sesión y aviso de versión nueva. |
| `controller-check/` | 4.8 | Un controlador de prueba contra la app de verdad como PC controlado, en el mismo Linux X11 y con el backend de desarrollo: autenticación, imagen, entrada, aviso, ocupado, Desconectar, confirmación local y bloqueo. |
| `viewer-check/` | 4.9, 6.4 y 6.5 | Dos instancias de la app (PC oculto y controlador manejado por DevTools): Equipos, conectar, errores, imagen, estado, ratón, reconexión y que el token no llegue a ningún renderer. |

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

### Segundo plano en macOS (tareas 4.1 y 4.2)

`test-mac.sh background` empaqueta la app de verdad como `dist/check/mac-<arquitectura>/AbsorCheck.app`, con otro nombre, otro appId y otra carpeta de datos (`absor-connect-check`), así que no toca Absor Connect si está instalado. Su versión es 0.0.1, para que la última release de GitHub cuente como versión nueva. Después la maneja con System Events, que también lee los iconos del propio Dock (`background-check.mjs`). La salida de la app, con el registro del actualizador, queda en `out/absorcheck-app.log` y las líneas de la actualización van al JSON. Comprueba:

- arranque con ventana, Dock e icono en la barra de menús;
- el menú (abrir, estado del control remoto, salir) y la entrada para descargar la versión nueva;
- cerrar a la bandeja (sin Dock), abrir desde la bandeja, abrir la app otra vez (misma instancia) y salir;
- arranque con `--hidden`;
- que «Abrir al iniciar sesión» la añade a Ítems de inicio.

La notificación de versión nueva y lo que se ve en Ítems de inicio se preguntan con diálogos. La primera vez macOS pide permiso para que Terminal controle System Events. Después hay que cerrar la sesión del Mac, volver a entrar sin abrir nada y lanzar `test-mac.sh background-login`. Esa segunda fase comprueba que la app arrancó sola y oculta, y que desactivar la opción la quita de Ítems de inicio.

## Controlador de prueba (`controller-check/`, tarea 4.8)

Hace lo que hará el visor (tarea 6.5) contra el PC controlado de verdad, en un solo equipo Linux X11:

- **El PC:** la app compilada (`out/`), arrancada con `--hidden` y una carpeta de datos propia (`--user-data-dir`). La sesión de la cuenta y la contraseña del PC se preparan en esa carpeta, sin cifrar (prefijo `p1:`, que la caja segura también lee).
- **El controlador:** esta ventana. Hace la oferta con transceptores `recvonly` y los canales, pide sesión por la API, deriva K con PBKDF2 de WebCrypto y envía la prueba de la contraseña.

Usa la cuenta `prueba-control-local@example.test`, que crea si no existe, porque el alta tiene un límite de 5 por hora y por IP. Pone un nombre de PC nuevo en cada ejecución, y `--delete-account=1` borra la cuenta al terminar. Dura unos 2 minutos y medio:

- mueve el ratón al centro de la pantalla y hace un clic en el aviso;
- abre durante 30 s una pregunta de confirmación, que **no hay que contestar** (se comprueba que se rechaza sola).

Con el backend de desarrollo levantado (`docker compose up -d`):

```bash
bin/dev npx electron-vite build
bin/dev sh -c 'cd prototypes/remote-desktop/controller-check && npx esbuild main.ts --bundle --platform=node --format=cjs --target=node22 --external:electron --external:koffi --outfile=out/main.cjs && npx esbuild controller.ts --bundle --platform=browser --format=iife --target=chrome130 --external:electron --outfile=out/controller.js'
node_modules/electron/dist/electron prototypes/remote-desktop/controller-check --api=http://127.0.0.1:8020 --host-data=/tmp/absor-host-check --out=/tmp/controller-check.json
```

## Prueba del visor (`viewer-check/`, tareas 4.9, 6.4 y 6.5)

Dos instancias de la app compilada en el mismo Linux X11, con el backend de desarrollo:

- **A, el PC controlado:** arranca con `--hidden` y su propia carpeta de datos, y queda con la contraseña puesta.
- **B, el controlador:** se maneja por el protocolo de DevTools (`--remote-debugging-port`), como lo haría una persona. Abre Equipos, pulsa Conectar y escribe la contraseña en la ventana de visor.

Para probar la reconexión, el renderer de la sesión de A se hace fallar con `Page.crash` (A también lleva su puerto de DevTools).

Se ejecuta con Electron como Node, porque el host no tiene Node:

```bash
bin/dev npx electron-vite build
bin/dev sh -c 'cd prototypes/remote-desktop/viewer-check && npx esbuild main.ts --bundle --platform=node --format=cjs --target=node22 --external:koffi --outfile=out/main.cjs'
ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron prototypes/remote-desktop/viewer-check/out/main.cjs --api=http://127.0.0.1:8020 --work=/tmp/absor-viewer-check --out=/tmp/viewer-check.json
```

Lleva el ratón al 10 % de la pantalla, una zona que no tapa el visor: si no, el cursor que mueve A caería sobre el visor de B y volvería a A en bucle. No hace clics en el PC.

Usa la misma cuenta de prueba que `controller-check`.

## Prueba de Ajustes (`settings-check/`, tarea 6.2)

La app compilada en un Linux X11, con el backend de desarrollo, manejada por DevTools como una persona. Prueba las secciones "Segundo plano" y "Control remoto de este PC": crear la contraseña, activar, cambiar el nombre y las funciones, cambiar la contraseña, ver el registro y desactivar. Lo que publica el PC lo comprueba en la API, con una segunda sesión de la misma cuenta.

```bash
bin/dev npx electron-vite build
bin/dev sh -c 'cd prototypes/remote-desktop/settings-check && npx esbuild main.ts --bundle --platform=node --format=cjs --target=node22 --outfile=out/main.cjs'
ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron prototypes/remote-desktop/settings-check/out/main.cjs --api=http://127.0.0.1:8020 --work=/tmp/absor-settings-check --out=/tmp/settings-check.json --screenshot=/tmp/settings.png
```

- Con `--screenshot` guarda dos capturas de la sección del control remoto: `settings.png` y `settings-2.png`.
- No toca "Abrir al iniciar sesión", porque en Linux escribiría en `~/.config/autostart` del usuario real.
- Al terminar espera a que la app se cierre (tarda unos 2,5 s), porque la siguiente ejecución usa la misma carpeta y el mismo puerto.

`lib/cdp.ts` tiene lo común para manejar una ventana por DevTools: listar las páginas, evaluar código, esperar a que algo se cumpla y hacer capturas.

Usa la misma cuenta de prueba que `controller-check`.

## Prueba entre dos equipos (`lan-check/`, tareas 4.8 y 6.5)

Dos equipos de la misma red con el backend de desarrollo de uno de ellos. Uno hace de PC controlado y el otro de controlador:

- **PC (`pc.ts`):** se ejecuta con Electron, no como Node.
  - Prepara la app de verdad con la cuenta de prueba, la contraseña del PC y el control remoto activado, y la arranca con su ventana.
  - Tapa la pantalla principal con una ventana de prueba, un área de texto que anota clics, rueda y teclas.
  - Abre una sonda HTTP en el puerto 8790 con el estado del ratón, las pantallas, el aviso, la bandeja, los bloqueos de suspensión y el registro. Por la sonda también hace acciones en la app: desactivar, cambiar la contraseña, confirmación local, mantener despierto y "Desconectar" del aviso.
  - Aparece en la cuenta como `PC de prueba <sistema> @<ip>:8790`, y así el controlador sabe dónde está la sonda.
  - Si el equipo no se puede controlar (faltan permisos de macOS, Wayland), lo dice y termina.
- **Controlador (`controller.ts`):** se ejecuta con Node o con Electron como Node.
  - Espera a que aparezca un PC de prueba de otro equipo y maneja su propia app por DevTools.
  - Comprueba cada paso con la sonda del PC.
  - Al terminar llama a `/done`, y el PC termina también.

Desde macOS, `lan-check/lan-test.sh http://<ip del otro equipo>:8020` hace las dos fases seguidas: primero el Mac es el PC y después el controlador. Con `pc` o `controlador` como segundo argumento, hace solo esa fase. Si sale a la red por Wi-Fi, en la segunda fase la corta 10 s con `networksetup` para probar la reconexión. Deja el JSON en `~/Downloads/absor-lan-check-macos.json` y en el portapapeles. En la primera fase, la pregunta de confirmación local sale dos veces: la primera no se responde, y la segunda se responde con "Permitir". La ventana de prueba lo va diciendo.

En el Linux, los dos papeles a la vez, en segundo plano. El backend escucha en todas las interfaces (`0.0.0.0:8020`):

```bash
bin/dev npx electron-vite build
bin/dev sh -c 'cd prototypes/remote-desktop/lan-check && for r in pc controller; do npx esbuild $r.ts --bundle --platform=node --format=cjs --target=node22 --external:electron --outfile=out/$r.cjs; done'
node_modules/electron/dist/electron prototypes/remote-desktop/lan-check/out/pc.cjs --api=http://127.0.0.1:8020 --work=/tmp/absor-lan/pc --out=/tmp/lan-pc.json --minutes=60 &
ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron prototypes/remote-desktop/lan-check/out/controller.cjs --api=http://127.0.0.1:8020 --work=/tmp/absor-lan/controller --out=/tmp/lan-controller.json --wait=45
```

Para ensayarla en un solo equipo, el PC se anuncia con `--advertise=127.0.0.1`. Así el controlador no lo descarta como propio.

**El controlador se ejecuta con Electron, no como Node**, porque escribe y lee el portapapeles de su equipo. Prueba también:

- **Ficheros:**
  - dos con el selector (`DOM.setFileInputFiles`) y el mismo otra vez soltándolo sobre la ventana (`Input.dispatchDragEvent`), para el nombre repetido;
  - cancelar uno de 400 MB a medias;
  - descargar desde el explorador, en una carpeta de la prueba (`ABSOR_CONNECT_SAVE_DIR`, sin diálogo).
  - Lo que llega a `Descargas/Absor Connect` del PC empieza por `absor-prueba` y se borra al terminar.
- **Portapapeles:** texto en los dos sentidos, una imagen y la pausa. Con los dos papeles en el mismo equipo no se puede, porque el portapapeles es el mismo.
- **Visor:** tamaño real, el menú de combinaciones, que Ctrl no se quede pulsado al perder el foco, y el bloqueo tras 5 contraseñas incorrectas.
- **Opciones:**
  - `--relay=1` obliga a ir solo por relé (`ABSOR_CONNECT_FORCE_RELAY`); necesita el servicio `turn` de `compose.override.yaml` y `TURN_URLS`/`TURN_SECRET` en `backend/.env.local` (ver D13).
  - `--second-pc=1` abre además una sesión con el PC de prueba del propio equipo («dos PCs a la vez»).

Para un PC arrancado a mano (por ejemplo, la máquina virtual de Windows):

- `lan-check/prepare-pc.ts` prepara su carpeta de datos: sesión, contraseña de pruebas y control remoto activado.
- La app se arranca con `--user-data-dir=<esa carpeta>` y `ABSOR_CONNECT_API_URL` apuntando al backend.
- `lan-check/hold-session.ts --pc="<nombre>" --seconds=60` abre una sesión desde este equipo y la mantiene, para ver en el PC la bandeja, el aviso o las notificaciones. Así se comprobó la bandeja de Windows (4.1).

Para el sonido, el PC suena un pitido de 440 Hz durante un segundo y medio, y el controlador mide el nivel de lo que recibe con el visor en silencio. Si el PC es un Linux, la entrada "Monitor of …" de su salida tiene que estar al 100 %. Si está baja, el sonido llega en silencio (ver D8).

Usa la misma cuenta de prueba que `controller-check`.
