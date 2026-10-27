# Contexto del visor de producción, con host artificial

Desde la raíz, con dependencias instaladas y un directorio de laboratorio propio
privado (0700):

```bash
node prototypes/remote-desktop/viewer-context-check/run.cjs /ruta/laboratorio
```

Empaqueta `src/renderer/viewer/main.ts` y su CSS/HTML reales. La ventana Electron
está aislada, sin Node en el renderer, y usa un perfil nuevo. El puente de API
es artificial; dos peers WebRTC locales intercambian DTLS y un vídeo de canvas
público. El desafío usa el vector público y las huellas aplicadas de esa conexión.
No hay red API, cuenta real, capturas del Mac, micrófono ni permisos del SO.

Comprueba negociación única, escritorio → transición sin imagen → entrada con
imagen, rechazo de secuencia antigua y regreso al escritorio con contenido
sensible aún suspendido hasta una conexión nueva. Guarda un informe y tres
capturas exclusivamente artificiales. El proceso se cierra en 45 segundos.
Los avisos de canal abortado al cerrar los dos peers son posteriores al ensayo.

Es una prueba del controlador y su interfaz. El host artificial declara soporte
de entrada para ejercitar la UI; no certifica captura/entrada de login/UAC ni
sustituye las pruebas de autorización, IPC, backend o trabajadores nativos.
`agentViewerState.test.ts` y las pruebas del visor cubren además retirada de
capacidades, audio, funciones sensibles y esperas asíncronas invalidadas.
