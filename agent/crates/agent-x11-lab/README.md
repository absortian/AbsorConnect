# Trabajador X11 de laboratorio

Base de captura y entrada nativas con Xlib/XTest, en un ejecutable exclusivo
de la VM Ubuntu/Cinnamon. Solo crea/captura su propia ventana pública de
320×180 y envía un clic y una tecla fija, con liberaciones. No se distribuye
como host de escritorio ni anuncia capacidades nuevas.

```bash
cargo build --manifest-path agent/Cargo.toml --locked --release -p absor-agent-x11-lab --example x11-worker-smoke --features x11-lab
python3 prototypes/backend-agent-check/isolated-webrtc-renewal.py /ruta/laboratorio --node /ruta/node --x11-worker-vm /ruta/VM-privada
```

El segundo comando requiere la VM propia del laboratorio en loopback:22223,
el controlador privado `vm-control.py` existente y el ejecutable compilado en
`/home/absorlab/AbsorConnectLab/api-workers/agent/target/release/examples/`.
El helper valida directorio/controlador privados y destino SSH, crea únicamente
`/run/absorconnect-owned-vm-lab` como root y lo retira al terminar. El programa
se ejecuta sin privilegios. La credencial de agente efímera viaja por stdin en
SSH; el túnel remoto liga solo loopback, sin puertos de router. Se desactivan
core dumps en esa ejecución. Las cuentas/BD pertenecen al ensayo aislado.

Antes de abrir Xlib y en cada operación exige la sesión de usuario X11 activa,
su UID y Display, el mismo identificador de sesión y `GetActive=false` de
Cinnamon. `LockedHint` no sustituye esa señal. La comprobación de foco tampoco
basta si un salvapantallas mantiene un agarre del teclado/puntero. Un error
inhabilita al trabajador; desbloquear no rehabilita la instancia anterior.

La prueba positiva comprueba cero operaciones nativas antes de autenticar,
una captura roja, un clic/tecla recibidos con sus liberaciones, captura verde,
caducidad al cortar API y denegación de operaciones posteriores. La negativa
activa el salvapantallas solo de la VM: debe cerrar sin captura o entrada.
El helper restaura el escritorio mediante una nueva sesión de la cuenta generada
del laboratorio. Si encuentra inicialmente la VM bloqueada, usa ese mismo ciclo;
no cambia políticas o contraseñas. No debe apuntarse a una máquina física.

Los canales internos tienen capacidad uno y el actor no espera a Xlib. Xlib
solo se utiliza en su hilo y se permite una ventana nativa por proceso. Las
bibliotecas del SO se mantienen mapeadas hasta la salida, para conservar sus
callbacks de hilo. El código unsafe está concentrado en el adaptador LP64.
El build normal no incluye este adaptador ni abre una conexión X11.

Límites pendientes: escritorio general, multimonitor/escalado, transiciones
continuas de contexto, entrada sostenida/modificadores, liberación tras muerte
abrupta desde otro proceso, IPC/almacén protegidos y systemd. La prueba usa
K y huellas públicas; no establece DTLS/WebRTC Linux ni certifica Mint físico.
Los resultados positivos del controlador Mac/WebRTC y los del trabajador Linux
se registran por separado. La capa final deberá ejecutar trabajadores aislados
y conectar el flujo de píxeles/entrada al transporte nativo autorizado.
