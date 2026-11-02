# Dependencias del escritorio: revisión del 02/11/2026

La auditoría completa de npm señalaba 52 paquetes (15 altos, 35 moderados y dos
bajos). Las actualizaciones compatibles del lockfile dejan 33 (dos altos y 31
moderados). Estos son recuentos de paquetes y cadenas afectadas, no de fallos
independientes ni de superficies accesibles desde el control remoto.

| Dependencia | Antes | Después |
|---|---|---|
| Electron | 39.8.5 | 39.8.10 |
| electron-updater | 6.8.3 | 6.8.11 |
| builder-util-runtime | 9.5.1 | 9.7.1 |
| electron-builder | 26.15.3 | 26.18.1 |
| Vite | 7.3.1 | 7.3.7 |
| js-yaml | 4.1.1 | 4.3.2 |

También se actualizan versiones transitivas afectadas de Babel, PostCSS,
fast-uri, nanoid, source-map-js, undici y el constructor XML. Se conservan los
rangos declarados y las versiones bloqueadas de Koffi, React y el cliente S3.
El pin de NSIS y la configuración de empaquetado no cambian.

Para npm con control de scripts de instalación se permiten solamente las siete
entradas de versión revisadas: Electron, cpu-features, las dos versiones de
esbuild presentes, Koffi, ssh2 y electron-winstaller. No se autoriza cualquier
script de dependencias futuras. El instalador de Electron se comprobó con Node
24; el flujo oficial de CI sigue fijando Node 22, como el entorno de desarrollo
documentado. No se abre Electron para descargarlo o compilar la aplicación.

## Pendiente antes de la publicación final

Persisten avisos altos de Electron y extract-zip. La auditoría propone migrar a
Electron 45.2.1; requiere validación propia de runtime, capturas, entrada y paquetes
en los tres sistemas. Esta actualización compatible no acredita esa migración.
Referencias: [Electron y certificados](https://github.com/advisories/GHSA-jr5w-w6x2-84p9)
y [traversal por enlaces en extract-zip](https://github.com/advisories/GHSA-7pqw-9j4j-h8q3).

Los avisos moderados restantes incluyen cadenas de herramientas dependientes de
minimatch. No se fuerza un cambio de API en todas las dependencias ni se adopta
la bajada de versión del empaquetador sugerida por `npm audit --force`.

## Verificación

Pasan typecheck, 466 pruebas Vitest (siete omitidas) y el build de producción de
main/preload/renderer. Los paquetes Windows/Linux/macOS se verifican en CI antes
de fusionar. No se publica una versión ni se activa el agente desatendido por
actualizar estas dependencias; la matriz certificada y los pilotos siguen sus
criterios de OpenSpec.
