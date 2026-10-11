# Absor Connect

*(antes Absor S3 Explorer)*

Aplicación de escritorio para gestionar archivos entre el sistema de archivos local y servicios remotos (almacenamiento compatible con S3, como AWS S3, MinIO o DigitalOcean Spaces, y servidores SSH mediante SFTP) desde una interfaz unificada de doble panel.

> **Nota:** Este proyecto es un experimento de *vibe coding*. Fue desarrollado íntegramente utilizando VS Code con GitHub Copilot, sin instrucciones precisas preconfiguradas, con el objetivo de explorar cómo responde el editor y su agente de IA ante peticiones abiertas y progresivas. El resultado es esta aplicación funcional construida de forma conversacional.

## Características

- **Explorador dual** — Panel izquierdo para el sistema de archivos local y panel derecho para el servicio remoto (buckets S3 o directorios SFTP), permitiendo navegar ambos simultáneamente.
- **Gestión de conexiones** — Crear, organizar en carpetas y persistir conexiones S3 y SSH. Las credenciales (claves de acceso, contraseñas y passphrases) se guardan cifradas con el almacén seguro del sistema.
- **Conexiones SSH / SFTP** — Autenticación por contraseña o por clave privada (ruta al fichero, con passphrase opcional; la clave no se copia a la app) y directorio inicial opcional.
- **Terminal SSH** — Terminales interactivas en pestañas junto al explorador, sobre la misma conexión SSH (sin volver a autenticarse). Varias a la vez, del mismo o de distintos servidores, con colores, UTF-8, programas a pantalla completa, redimensionado automático y reconexión. Copiar y pegar: **Cmd+C / Cmd+V** en macOS y **Ctrl+Shift+C / Ctrl+Shift+V** en Windows y Linux (Ctrl+C envía la interrupción al servidor).
- **Transferencias drag-and-drop** — Arrastrar archivos entre paneles para subir o descargar. También disponible mediante menú contextual.
- **Cola de transferencias** — Barra inferior que muestra el estado en tiempo real de cada transferencia (pendiente, subiendo, descargando, completado, error).
- **Operaciones remotas** — Crear carpetas, eliminar objetos o archivos (en SFTP, las carpetas se borran con todo su contenido) y descargar archivos individuales.
- **Interfaz moderna** — Tema oscuro con elementos glassmorphism, sidebar colapsable e indicadores de estado en tiempo real.

## Stack tecnológico

| Categoría | Tecnología |
|---|---|
| Framework de escritorio | Electron |
| UI | React + TypeScript |
| Build | Vite (electron-vite) |
| AWS SDK | @aws-sdk/client-s3 |
| SSH / SFTP | ssh2 |
| Terminal | xterm.js (@xterm/xterm) |
| Persistencia | electron-store |
| Iconos | lucide-react |
| Empaquetado | electron-builder |

## Desarrollo

```bash
# Instalar dependencias
npm install

# Ejecutar en modo desarrollo
npm run dev

# Compilar para producción
npm run build
```

## Plataformas soportadas

- **macOS** — ARM64 (Apple Silicon), formatos DMG y ZIP
- **Windows** — Instalador NSIS
- **Linux** — AppImage, Snap y DEB

## Seguridad

- **Host key SSH sin verificar:** Absor Connect acepta la clave de host de cualquier servidor SSH sin comprobarla. Es una decisión consciente para esta versión, pero implica que en una red no confiable un atacante podría suplantar al servidor (man-in-the-middle) y capturar la contraseña o los datos transferidos. Usa autenticación por clave privada y redes de confianza siempre que puedas.
- **Exportación de conexiones:** el fichero exportado contiene todas las credenciales sin cifrar.

## Historial

Hasta la v0.0.7 la aplicación se llamaba **Absor S3 Explorer** y el repositorio era `absortian/AbsorS3Explorer`. Las instalaciones de esas versiones siguen buscando actualizaciones en esa ruta y GitHub las redirige a `absortian/AbsorConnect`, así que **no se debe crear un repositorio nuevo llamado `AbsorS3Explorer`**: rompería la redirección y esas instalaciones dejarían de recibir actualizaciones.
