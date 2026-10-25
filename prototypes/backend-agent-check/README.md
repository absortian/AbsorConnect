# Concurrencia del backend del agente

Con el backend de desarrollo en marcha:

```bash
python3 prototypes/backend-agent-check/run.py
```

Solo usa la API local fija `http://127.0.0.1:8020`. Crea una cuenta efímera,
contraseña y claves aleatorias que no imprime; retira la cuenta al terminar.
El informe contiene únicamente estados y resultados. No lee cuentas existentes,
no contacta con producción y no instala agentes.

Ensaya tres canjes dobles concurrentes (un 201 y un 400), el canje frente al
registro legado (un solo propietario) y el canje frente al logout de origen
(ninguna credencial sobrevive). Comprueba la revocación por la API. Son peticiones
HTTP paralelas reales; no sustituyen las pruebas de revocación a 30 segundos del
trabajador nativo ni la matriz completa de plataformas.

## Renovación Rust y corte de un proceso

```bash
cargo build --manifest-path agent/Cargo.toml --locked -p absor-agent-api --example api-smoke --features lab-http
python3 -B prototypes/backend-agent-check/native-renewal.py
```

El segundo lanzador crea dos cuentas/dispositivos propios de laboratorio y usa
el cliente Rust real contra esa misma API local. Un proxy ligado solo a
`127.0.0.1` permite cortar las peticiones del caso de red sin detener la API.
Una prueba revoca el agente; otra deja de obtener respuestas. El binario
recibe la credencial únicamente por stdin, mantiene el temporizador durante
las peticiones y termina su hijo propio cuando pierde autorización. La cuenta
se retira en `finally`, independientemente del cierre del proxy. El informe
solo contiene fases, tiempos y booleanos.

`lab-http` es optativo y está desactivado en el servicio: su constructor admite
solo HTTP con la IP literal loopback y puerto. El constructor normal sigue
exigiendo HTTPS. El proceso hijo no captura ni envía entrada, y se simula la
frontera del autenticador v1: esta prueba no acredita P2P ni un agente final.
No apuntar este lanzador a producción ni reutilizar cuentas del propietario.

## API aislada y trabajador WebRTC con autenticación Rust

`isolated-webrtc-renewal.py /ruta/laboratorio --node /ruta/node` prepara una
API temporal en un puerto loopback libre, con la imagen PHP de desarrollo,
cache tmpfs y una BD exclusiva en el Postgres de desarrollo. Conserva los
límites de registro y retira contenedor/BD/entorno al terminar, incluso si falla
la matriz. No resetea los contadores compartidos ni cambia la API de desarrollo.
Requiere sus contenedores existentes; no lee configuración de producción.

Invoca `webrtc-renewal.py`, que crea cinco cuentas/dispositivos efímeros, un
proxy de fallo local y manifiestos privados. El runner Electron comprueba HMAC,
DTLS, vídeo artificial y cierre por revocación/caducidad con el cliente Rust.
Después verifica que el token revocado y el cliente sin API no llegan a crear
otra PeerConnection. El visor no recibe credenciales y prueba que no puede leer
rutas privadas ni archivos locales. Las cuentas y copias de tokens se retiran.

Hay que compilar antes con `webrtc-check/build.py ... --rust-bridge`. La nueva
ABI/target son solo de laboratorio Mac; no es un agente instalable ni prueba
captura/entrada/TURN/móvil. Los informes distinguen cada límite. Los logs y los
archivos de señalización contienen metadatos locales: mantenerlos privados.
