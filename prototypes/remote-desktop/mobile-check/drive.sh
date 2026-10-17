#!/bin/bash
# Dentro del contenedor del emulador (ver run.sh): lanza la prueba de integración del control remoto
# y atiende lo que pide escribiendo en su salida:
#   SHOT <nombre>  captura con adb (con la imagen del PC, que no sale en las capturas de Flutter)
#   HOME <s>       pulsa Inicio, espera <s> segundos y vuelve a abrir la app
#   BACK           pulsa Atrás (cierra la hoja de compartir del sistema)
#   REPORT i/n <b> resultado de todas las comprobaciones: JSON en base64, a trozos (Android parte
#                  las líneas largas del registro)
set -u
out=${1:?carpeta de salida}
mkdir -p "$out/shots"
rm -f "$out"/shots/*.png "$out/report.json" "$out/report.b64" "$out/drive.log"
cd /repo/mobile
export SHOTS_DIR="$out/shots"
# El aviso de Android "Viewing full screen" se queda con el foco (y sin foco no se puede leer el
# portapapeles): se da por visto antes de empezar
adb shell settings put secure immersive_mode_confirmations confirmed
flutter drive --driver=test_driver/integration_test.dart --target=integration_test/remote_desktop_test.dart \
  --dart-define=API_URL=http://10.0.2.2:8020 --dart-define=PROBE_URL=http://10.0.2.2:8790 -d "$ANDROID_SERIAL" 2>&1 |
  while IFS= read -r line; do
    echo "$line" >>"$out/drive.log"
    case "$line" in
      *"SHOT "*) adb exec-out screencap -p >"$out/shots/${line##*SHOT }.png" ;;
      *"HOME "*)
        adb shell input keyevent KEYCODE_HOME
        sleep "${line##*HOME }"
        adb shell monkey -p com.absor.connect -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
        ;;
      *BACK*) adb shell input keyevent KEYCODE_BACK ;;
      *"REPORT "*)
        part=${line##*REPORT }
        printf '%s' "${part#* }" | tr -d '[:space:]' >>"$out/report.b64"
        # El último trozo (i = n) completa el JSON
        index=${part%% *}
        [ "${index%/*}" = "${index#*/}" ] && base64 -d "$out/report.b64" >"$out/report.json" && rm -f "$out/report.b64"
        ;;
      *"OK   "* | *FALLO* | *"Some tests"* | *"All tests"* | *Error*) echo "$line" ;;
    esac
  done
chown -R "${HOST_UID:-0}:${HOST_GID:-0}" "$out" /repo/mobile 2>/dev/null
[ -f "$out/report.json" ]
