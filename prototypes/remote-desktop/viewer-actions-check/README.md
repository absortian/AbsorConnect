# Operaciones del visor en WebRTC local

```bash
node prototypes/remote-desktop/viewer-actions-check/run.cjs /ruta/laboratorio-privado
```

Empaqueta el HTML/CSS y `main.ts` reales del visor. El host artificial usa dos
peers Chromium y el vector público de contraseña; cada conexión tiene nonce y
huellas nuevos. Solo captura un canvas y cuenta las operaciones. No ejecuta
bloqueo, logout, atención segura o reinicio del SO; no tiene token de cuenta,
credenciales del propietario ni API externa. No simula el preload confiable:
los permisos/remitentes de main se prueban en `controllerViewerIpc.test.ts`.

Comprueba confirmación cancelada, retirada de capacidad mientras está abierta,
rechazo sin espera, aceptación y resultado perdido sin reenviar la orden.
Durante la espera no hay ofertas fuera de línea. Cancelar no abre una oferta;
volver exige contraseña y un reto nuevo. Las teclas del diálogo no van al host.
El botón de cancelar se comprueba por hit-test; capturas es/en, incluida ventana
estrecha, esperan dos frames de pintura. La presencia vuelve mediante el puente
simulado: no acredita un reinicio real ni los plazos de recuperación del agente.

Los tests de reloj de `hostActions.test.ts` verifican retorno a diez segundos,
vencimiento independiente a cinco minutos incluso con consulta bloqueada,
respuesta tardía, cancelación, Retry-After y ausencia de consultas solapadas.
El lanzador exige salida correcta e informe `ok`; Electron no debe ocultar una
excepción al cerrar. Los perfiles, capturas y fallos quedan privados en el
laboratorio. Los prototipos se excluyen de app.asar.
