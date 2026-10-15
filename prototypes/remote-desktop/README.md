# Prototipos de add-remote-desktop

Pruebas de los puntos de riesgo del grupo 1 de `openspec/changes/add-remote-desktop/tasks.md`. No forman parte de la app ni entran en su paquete. Se borran al terminar el cambio.

| Prueba | Tarea | Qué comprueba |
|---|---|---|
| `input` | 1.3 | `koffi` carga y mueve el ratón con la API nativa (SendInput, CGEvent, XTest). |
| `pbkdf2` | 1.4 | Lo que tarda PBKDF2-HMAC-SHA256 en WebCrypto y en Node. |
| `capture` | 1.1 y 1.2 | Captura de la pantalla principal en una ventana oculta, sin ventana principal, enviada por WebRTC a otra ventana oculta: imágenes por segundo y sonido del sistema. |

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
