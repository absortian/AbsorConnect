# Laboratorio Linux automatizado en el Mac

El propietario pidió reducir las intervenciones físicas durante los ensayos.
Se creó una VM independiente de UTM, administrada por SSH y por la consola
virtual de QEMU. El Mac anfitrión es ARM; este laboratorio usa Ubuntu ARM y no
se presenta como certificación del Mint x86 físico.

## Configuración verificada el 25/10/2026

- Ubuntu 24.04.5 LTS aarch64, imagen oficial de 17/10/2026; SHA-256 comprobado
  contra el manifiesto de Ubuntu.
- QEMU 11.1.2 con HVF, dos vCPU, 4096 MiB de RAM y disco qcow2 de 40 GiB
  virtuales, sobre la imagen base.
- Cinnamon 6.0.4, LightDM 1.30.0, Slick Greeter 2.0.1 y AT-SPI 2.52.0.
- SSH por clave exclusiva en `127.0.0.1:22223`; sockets QMP/VNC en una carpeta
  privada. La cuenta de laboratorio permite administración sin interacción en
  esta VM. Sus credenciales son exclusivas y quedan fuera del repositorio.

El directorio privado está en
`/Users/absor/Documents/DEV/AbsorConnectLab/linux-arm-vm-20261025`.
Contiene imagen/manifiesto, semilla NoCloud, clave, configuración de arranque,
controladores y evidencias. No copiar su contenido íntegro a Git o a un informe:
la semilla y los archivos de credenciales pertenecen al laboratorio privado.

## Operaciones comprobadas

1. Arranque de la imagen, aprovisionamiento NoCloud sin errores y acceso SSH
   como usuario y administrador.
2. Inicio de LightDM, captura de su consola virtual y observación accesible del
   campo de contraseña como `lightdm`, sin grupos adicionales.
3. Inicio de sesión gráfico con la cuenta generada de laboratorio mediante
   teclado virtual QMP, cierre de sesión administrativo y nuevo inicio de
   sesión. Todo el ciclo se ejecutó sin intervención del propietario.
4. Apagado limpio, creación del punto `desktop-ready`, copia de variables UEFI
   y nuevo arranque hasta LightDM.
5. Restauración del disco y de las variables UEFI. Un marcador creado después
   del punto desapareció al restaurarlo; se verificó otro inicio de sesión.
6. Los prototipos existentes pasaron en el escritorio de la VM: XGetImage contó
   diez fotogramas no uniformes en una región de 128 × 72 y la ventana GTK
   recibió un clic y una tecla por XTest, con sus liberaciones y cero eventos
   inesperados. Se restauró el puntero; el foco X11 anterior no se observó
   restaurado en ese ensayo. No quedaron procesos de esos prototipos.

La evidencia pública reconciliada está en
`openspec/changes/add-unattended-admin-access/linux-arm-virtual-lab-results.json`;
incluye hashes de informes y controladores privados, sin credenciales.

## Control local del laboratorio

Desde Terminal del Mac, los controladores privados admiten estas operaciones:

```bash
python3 /Users/absor/Documents/DEV/AbsorConnectLab/linux-arm-vm-20261025/vm-control.py status
python3 /Users/absor/Documents/DEV/AbsorConnectLab/linux-arm-vm-20261025/vm-control.py logout
python3 /Users/absor/Documents/DEV/AbsorConnectLab/linux-arm-vm-20261025/vm-control.py login
python3 /Users/absor/Documents/DEV/AbsorConnectLab/linux-arm-vm-20261025/vm-lifecycle.py stop
python3 /Users/absor/Documents/DEV/AbsorConnectLab/linux-arm-vm-20261025/vm-lifecycle.py start
python3 /Users/absor/Documents/DEV/AbsorConnectLab/linux-arm-vm-20261025/vm-lifecycle.py restore
```

`restore` vuelve al punto `desktop-ready` y descarta los cambios posteriores de
esta VM. `login` exige sesión greeter y campo de contraseña enfocado comprobado
por metadatos; usa exclusivamente la credencial generada de laboratorio y no
la imprime. La clave de host SSH se contrastó con la consola serie al crear
el laboratorio y las conexiones posteriores exigen esa identidad.

## Descubrimiento del foco de LightDM

En el Mint físico la segunda revisión del observador detectó el greeter, pero
las 36 consultas de `AT_SPI_BUS` devolvieron propiedad ausente. Por eso no se
solicitó otra repetición del mismo procedimiento físico.

En la VM se comprobó una vía alternativa: extraer únicamente
`DBUS_SESSION_BUS_ADDRESS` del entorno acotado del proceso Slick Greeter cuyo
UID y ejecutable se verifican. La dirección se entrega a un trabajador como
`lightdm`, nunca a un cliente D-Bus root. El trabajador comprueba el PID/UID
propietario de `x.dm.SlickGreeter`, exige `org.a11y.Bus` ya activo y consulta
`GetAddress` sin activación automática. No se guardan la dirección ni el
entorno. El trabajador accesible original, precedido por ese descubrimiento,
observó un único campo de contraseña enfocado y terminó antes del inicio de
sesión. Solo consulta roles/estados, no texto, valores o acciones.

Esta vía está comprobada en el laboratorio ARM. Aún no se ha incorporado al
supervisor completo ni validado en el greeter del Mint físico.

## Alcance

El laboratorio permite automatizar preparación, controles de consola,
transiciones y recuperación. QMP es el controlador externo de las pruebas;
sus pulsaciones de acceso no son evidencia de entrada del agente AbsorConnect.
Los prototipos de captura y entrada conservan sus límites anteriores.

Las versiones de Cinnamon/Slick Greeter y la arquitectura difieren del Mint
físico; queda aceptación en hardware real y en los Windows/Mac objetivo. Los
permisos y diálogos de propietario exigidos por cada SO siguen formando parte
de la instalación y la validación correspondientes. No se declara completada
la tarea 1.4, el agente o la publicación: **8/57**, `readyForUnattended:false`.

Referencias de aprovisionamiento:
[imagen oficial de Ubuntu](https://cloud-images.ubuntu.com/noble/20261017/),
[NoCloud](https://docs.cloud-init.io/en/latest/reference/datasources/nocloud.html)
y [redirección de red de QEMU](https://www.qemu.org/docs/master/system/qemu-manpage.html).
