# Absor Connect

*(antes Absor S3 Explorer)*

Aplicación de escritorio para gestionar archivos entre el sistema de archivos local y cualquier servicio de almacenamiento compatible con S3 (AWS S3, MinIO, DigitalOcean Spaces, etc.) desde una interfaz unificada de doble panel.

> **Nota:** Este proyecto es un experimento de *vibe coding*. Fue desarrollado íntegramente utilizando VS Code con GitHub Copilot, sin instrucciones precisas preconfiguradas, con el objetivo de explorar cómo responde el editor y su agente de IA ante peticiones abiertas y progresivas. El resultado es esta aplicación funcional construida de forma conversacional.

## Características

- **Explorador dual** — Panel izquierdo para el sistema de archivos local y panel derecho para buckets S3, permitiendo navegar ambos simultáneamente.
- **Gestión de conexiones** — Crear, organizar en carpetas y persistir múltiples conexiones S3 con soporte para servicios compatibles (MinIO, etc.).
- **Transferencias drag-and-drop** — Arrastrar archivos entre paneles para subir o descargar. También disponible mediante menú contextual.
- **Cola de transferencias** — Barra inferior que muestra el estado en tiempo real de cada transferencia (pendiente, subiendo, descargando, completado, error).
- **Operaciones S3** — Crear carpetas, eliminar objetos y descargar archivos individuales desde los buckets.
- **Interfaz moderna** — Tema oscuro con elementos glassmorphism, sidebar colapsable e indicadores de estado en tiempo real.

## Stack tecnológico

| Categoría | Tecnología |
|---|---|
| Framework de escritorio | Electron |
| UI | React + TypeScript |
| Build | Vite (electron-vite) |
| AWS SDK | @aws-sdk/client-s3 |
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

## Historial

Hasta la v0.0.7 la aplicación se llamaba **Absor S3 Explorer** y el repositorio era `absortian/AbsorS3Explorer`. Las instalaciones de esas versiones siguen buscando actualizaciones en esa ruta y GitHub las redirige a `absortian/AbsorConnect`, así que **no se debe crear un repositorio nuevo llamado `AbsorS3Explorer`**: rompería la redirección y esas instalaciones dejarían de recibir actualizaciones.
