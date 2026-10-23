// ignore: unused_import
import 'package:intl/intl.dart' as intl;

import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Spanish Castilian (`es`).
class AppLocalizationsEs extends AppLocalizations {
  AppLocalizationsEs([String locale = 'es']) : super(locale);

  @override
  String get appTitle => 'Absor Connect';

  @override
  String get authSubtitle =>
      'Inicia sesión para tener tus conexiones en todos tus dispositivos.';

  @override
  String get authLogin => 'Iniciar sesión';

  @override
  String get authRegister => 'Crear cuenta';

  @override
  String get authEmail => 'Email';

  @override
  String get authPassword => 'Contraseña';

  @override
  String get authConfirmPassword => 'Repite la contraseña';

  @override
  String get authPasswordHint => 'Al menos 10 caracteres.';

  @override
  String get authExpired =>
      'Tu sesión ha caducado o se ha cerrado desde otro lugar. Vuelve a iniciar sesión.';

  @override
  String get connectionsTitle => 'Conexiones';

  @override
  String get connectionsEmpty => 'Aún no hay conexiones.';

  @override
  String get connectionsEmptyHint =>
      'Pulsa + para añadir una conexión S3 o SSH. Las que crees en el ordenador también aparecen aquí.';

  @override
  String get connectionsConflict =>
      'Otro equipo ha cambiado tus conexiones. Se ha cargado la lista actual y tu último cambio no se ha guardado: repítelo.';

  @override
  String saveFailed(String reason) {
    return 'No se pudo guardar el cambio: $reason';
  }

  @override
  String loadFailed(String reason) {
    return 'No se pudieron cargar tus conexiones: $reason';
  }

  @override
  String get retry => 'Reintentar';

  @override
  String get credentialsUnavailable =>
      'Las credenciales guardadas de esta conexión no están disponibles. Edítala para volver a introducirlas.';

  @override
  String get addConnection => 'Nueva conexión';

  @override
  String get addFolder => 'Nueva carpeta';

  @override
  String get editConnection => 'Editar conexión';

  @override
  String get folderName => 'Nombre de la carpeta';

  @override
  String get typeS3 => 'S3';

  @override
  String get typeSsh => 'SSH / SFTP';

  @override
  String get connectionName => 'Nombre de la conexión';

  @override
  String get folder => 'Carpeta';

  @override
  String get folderNone => 'Ninguna';

  @override
  String get endpoint => 'URL del endpoint';

  @override
  String get region => 'Región';

  @override
  String get accessKeyId => 'Access Key ID';

  @override
  String get secretAccessKey => 'Secret Access Key';

  @override
  String get defaultBucket => 'Bucket por defecto (opcional)';

  @override
  String get host => 'Host';

  @override
  String get port => 'Puerto';

  @override
  String get username => 'Usuario';

  @override
  String get authMethod => 'Autenticación';

  @override
  String get authMethodPassword => 'Contraseña';

  @override
  String get authMethodKey => 'Clave privada';

  @override
  String get password => 'Contraseña';

  @override
  String get privateKey => 'Clave privada';

  @override
  String get importKey => 'Importar fichero de clave';

  @override
  String keyImported(String name) {
    return 'Clave importada: $name';
  }

  @override
  String get keyNotImported => 'Ninguna clave importada en este dispositivo';

  @override
  String get keyStaysHere =>
      'La clave se queda en este dispositivo: en tu cuenta solo se guarda el nombre del fichero.';

  @override
  String get keyInvalid =>
      'Ese fichero no es una clave privada válida o la passphrase no es correcta.';

  @override
  String get passphrase => 'Passphrase (opcional)';

  @override
  String get initialPath => 'Directorio inicial (opcional)';

  @override
  String get required => 'Obligatorio';

  @override
  String get invalidPort => 'Puerto entre 1 y 65535';

  @override
  String get keepUnavailable =>
      'Deja vacíos los campos secretos para conservar las credenciales guardadas.';

  @override
  String get save => 'Guardar';

  @override
  String get cancel => 'Cancelar';

  @override
  String get delete => 'Borrar';

  @override
  String get edit => 'Editar';

  @override
  String get moveTo => 'Mover a carpeta';

  @override
  String get root => 'Sin carpeta';

  @override
  String get openTerminal => 'Abrir terminal';

  @override
  String get openFiles => 'Ver archivos';

  @override
  String deleteConnectionConfirm(String name) {
    return '¿Borrar «$name»?';
  }

  @override
  String get deleteFolderConfirm =>
      'Se borrará la carpeta y todo lo que contiene, de tu cuenta y en todos tus equipos.';

  @override
  String get deleteConnectionBody =>
      'La conexión se borrará de tu cuenta y en todos tus equipos.';

  @override
  String get upload => 'Subir';

  @override
  String get uploadFromFiles => 'Desde Archivos';

  @override
  String get uploadFromPhotos => 'Desde Fotos';

  @override
  String get newRemoteFolder => 'Nueva carpeta';

  @override
  String get download => 'Descargar y compartir';

  @override
  String deleteItemConfirm(String name) {
    return '¿Borrar «$name»?';
  }

  @override
  String get deleteItemFolderBody =>
      'Se borrará la carpeta con todo su contenido.';

  @override
  String get deleteItemBody => 'No se puede deshacer.';

  @override
  String get emptyFolder => 'Esta carpeta está vacía.';

  @override
  String get buckets => 'Buckets';

  @override
  String get refresh => 'Recargar';

  @override
  String get transfers => 'Transferencias';

  @override
  String get transferUploading => 'Subiendo';

  @override
  String get transferDownloading => 'Descargando';

  @override
  String get transferDone => 'Hecho';

  @override
  String transferFailed(String reason) {
    return 'Error: $reason';
  }

  @override
  String get share => 'Compartir';

  @override
  String get clearFinished => 'Quitar terminadas';

  @override
  String get terminals => 'Terminales';

  @override
  String get noTerminals =>
      'No hay terminales abiertas. Abre una desde una conexión SSH.';

  @override
  String get reconnect => 'Reconectar';

  @override
  String get closeTerminal => 'Cerrar terminal';

  @override
  String get terminalClosed => 'La sesión ha terminado.';

  @override
  String get terminalConnecting => 'Conectando…';

  @override
  String get settings => 'Ajustes';

  @override
  String get signedInAs => 'Sesión iniciada como';

  @override
  String get logout => 'Cerrar sesión';

  @override
  String version(String version) {
    return 'Versión $version';
  }

  @override
  String get checkUpdates => 'Buscar actualizaciones';

  @override
  String get upToDate => 'Ya tienes la última versión.';

  @override
  String updateAvailable(String version) {
    return 'Hay una versión nueva: $version.';
  }

  @override
  String get updateDownload => 'Descargar';

  @override
  String get website => 'Web y ayuda';

  @override
  String get keyMissingTitle => 'Importa la clave privada';

  @override
  String keyMissingBody(String name) {
    return 'Esta conexión usa la clave privada «$name». Importa ese fichero en este dispositivo para conectar; se quedará solo en este dispositivo.';
  }

  @override
  String get err_invalid_credentials =>
      'El email o la contraseña no son correctos.';

  @override
  String get err_email_taken =>
      'Ya existe una cuenta con ese email. Inicia sesión.';

  @override
  String get err_email_invalid => 'El email no es válido.';

  @override
  String get err_password_too_short =>
      'La contraseña debe tener al menos 10 caracteres.';

  @override
  String get err_password_too_long => 'La contraseña es demasiado larga.';

  @override
  String get err_password_mismatch => 'Las contraseñas no coinciden.';

  @override
  String get err_too_many_attempts =>
      'Demasiados intentos. Espera un poco y vuelve a probar.';

  @override
  String get err_network_error =>
      'No se puede contactar con el servicio. Comprueba tu conexión a internet.';

  @override
  String get err_server_error =>
      'El servicio no está disponible ahora mismo. Inténtalo más tarde.';

  @override
  String get err_connections_invalid =>
      'El servicio ha rechazado la lista de conexiones.';

  @override
  String get err_ssh_auth_failed =>
      'Falló la autenticación: revisa el usuario, la contraseña o la clave.';

  @override
  String get err_ssh_unreachable =>
      'No se puede contactar con el servidor. Revisa el host, el puerto y tu red.';

  @override
  String get err_ssh_timeout =>
      'El servidor ha tardado demasiado en responder.';

  @override
  String get err_ssh_key_missing =>
      'La clave privada no está importada en este dispositivo.';

  @override
  String get err_ssh_key_invalid =>
      'No se pudo leer la clave privada (¿passphrase incorrecta?).';

  @override
  String get err_ssh_disconnected =>
      'Se ha perdido la conexión con el servidor.';

  @override
  String err_sftp_error(String detail) {
    return 'El servidor rechazó la operación: $detail';
  }

  @override
  String get err_s3_access_denied =>
      'Acceso denegado: revisa las claves y los permisos.';

  @override
  String get err_s3_not_found => 'El bucket o el fichero no existe.';

  @override
  String err_s3_error(String detail) {
    return 'El servicio de almacenamiento devolvió un error: $detail';
  }

  @override
  String err_s3_redirect(String location) {
    return 'El servidor redirige a $location. Usa esa dirección como endpoint.';
  }

  @override
  String err_s3_tls_error(String detail) {
    return 'No se pudo abrir una conexión segura con el servidor (certificado no válido o no reconocido por el móvil): $detail';
  }

  @override
  String get err_s3_invalid_endpoint =>
      'El endpoint no es una dirección válida. Escríbela completa, por ejemplo https://s3.ejemplo.com';

  @override
  String get err_unknown => 'Algo ha fallado. Inténtalo de nuevo.';

  @override
  String get devicesTitle => 'Equipos';

  @override
  String get devicesHint =>
      'Los PCs de tu cuenta con Absor Connect. Para controlar uno, tiene que estar en línea y con el control remoto activado; te pedirá su contraseña.';

  @override
  String get devicesEmpty =>
      'Todavía no hay equipos en la cuenta. Activa el control remoto en Ajustes de la app de escritorio.';

  @override
  String devicesLoadFailed(String reason) {
    return 'No se ha podido cargar la lista de equipos: $reason';
  }

  @override
  String get deviceStateAvailable => 'Disponible';

  @override
  String get deviceStateBusy => 'Ocupado: otro equipo lo está controlando';

  @override
  String get deviceStateDisabled => 'Control remoto desactivado';

  @override
  String get deviceStateMissingPermissions => 'Faltan permisos del sistema';

  @override
  String get deviceStateUnsupported => 'Su sistema no permite controlarlo';

  @override
  String get deviceStateOffline => 'Sin conexión';

  @override
  String get remoteConnect => 'Conectar';

  @override
  String remotePasswordTitle(String pc) {
    return 'Conectar con $pc';
  }

  @override
  String get remotePasswordHint =>
      'Escribe la contraseña de control remoto de ese PC.';

  @override
  String get remotePassword => 'Contraseña del PC';

  @override
  String get remoteConnecting => 'Conectando…';

  @override
  String get remoteWaitingPc => 'Esperando al PC…';

  @override
  String get remoteAuthenticating => 'Comprobando la contraseña…';

  @override
  String get remoteReconnecting => 'Se ha perdido la conexión. Reconectando…';

  @override
  String get remoteDirect => 'Directa';

  @override
  String get remoteRelay => 'Por relé';

  @override
  String get remoteDisconnect => 'Desconectar';

  @override
  String get remoteReconnect => 'Reconectar';

  @override
  String get remoteBack => 'Volver';

  @override
  String get remoteMouseMode => 'Modo ratón: el dedo mueve el puntero';

  @override
  String get remoteTouchMode => 'Modo táctil: tocar hace clic ahí';

  @override
  String get remoteKeyboard => 'Teclado';

  @override
  String remoteDisplay(String number) {
    return 'Pantalla $number';
  }

  @override
  String get remoteSendClipboard => 'Enviar el portapapeles al PC';

  @override
  String get remoteClipboardSent => 'Portapapeles enviado al PC.';

  @override
  String get remoteClipboardEmpty =>
      'No hay texto en el portapapeles del teléfono.';

  @override
  String get remoteMute => 'Silenciar';

  @override
  String get remoteUnmute => 'Activar el sonido';

  @override
  String get remoteSendFile => 'Enviar fichero';

  @override
  String get remoteSendPhoto => 'Enviar foto o vídeo';

  @override
  String get remoteDownload => 'Descargar del PC';

  @override
  String get remoteTransfers => 'Transferencias';

  @override
  String get remoteClearFinished => 'Quitar las terminadas';

  @override
  String remoteSentAs(String name) {
    return 'En el PC como «$name»';
  }

  @override
  String get remoteShare => 'Compartir';

  @override
  String get remoteQueued => 'En cola';

  @override
  String get remoteCancelled => 'Cancelado';

  @override
  String get remoteUp => 'Carpeta superior';

  @override
  String get remoteFolderEmpty => 'Carpeta vacía';

  @override
  String get remoteTruncated => 'Solo se muestran los 5000 primeros.';

  @override
  String get remoteFeatureOff => 'El PC no lo permite en esta sesión.';

  @override
  String get remoteClosedLocal => 'Se ha desconectado desde el PC.';

  @override
  String get remoteClosedDisabled => 'El PC ha desactivado el control remoto.';

  @override
  String get remoteClosedPasswordChanged => 'Ha cambiado la contraseña del PC.';

  @override
  String get remoteClosedSignedOut =>
      'El PC ha cerrado la sesión de la cuenta.';

  @override
  String get remoteClosedStopped => 'La app del PC se ha cerrado.';

  @override
  String get remoteClosedCaptureFailed =>
      'El PC no ha podido capturar la pantalla.';

  @override
  String get remoteClosedBackground =>
      'La sesión se ha cerrado porque la app estuvo más de 30 segundos en segundo plano.';

  @override
  String get remoteClosedOther => 'El PC ha cerrado la sesión.';

  @override
  String get remoteErrWrongPassword => 'Contraseña incorrecta.';

  @override
  String remoteErrLocked(String minutes) {
    return 'Demasiados intentos fallidos. El PC no acepta conexiones durante $minutes min.';
  }

  @override
  String get remoteErrBusy => 'Otro equipo está controlando ese PC ahora.';

  @override
  String get remoteErrDeviceOffline =>
      'El PC no está conectado: la app no está en marcha o no tiene red.';

  @override
  String get remoteErrRemoteDisabled =>
      'El control remoto está desactivado en ese PC.';

  @override
  String get remoteErrMissingPermissions =>
      'A ese PC le faltan permisos del sistema para dejarse controlar.';

  @override
  String get remoteErrUnsupported =>
      'Ese PC no puede dejarse controlar ahora: su sistema no lo permite (por ejemplo, Linux con Wayland) o no ha podido abrir la sesión.';

  @override
  String get remoteErrDeclined =>
      'En el PC han rechazado la conexión, o nadie la aceptó a tiempo.';

  @override
  String get remoteErrConnectionFailed =>
      'La red no permite conectar con ese PC.';

  @override
  String get remoteErrNoAnswer => 'El PC no ha respondido.';

  @override
  String get remoteErrReconnectFailed =>
      'No se ha podido recuperar la conexión.';

  @override
  String remoteErrTooManyRequests(String seconds) {
    return 'Demasiadas solicitudes. Prueba de nuevo en $seconds s.';
  }

  @override
  String get remoteErrUnavailable =>
      'El control remoto no está disponible ahora mismo en el servicio.';

  @override
  String get remoteErrDeviceNotFound => 'Ese PC ya no está en la cuenta.';

  @override
  String remoteErrOther(String code) {
    return 'No se ha podido conectar ($code).';
  }

  @override
  String get remoteTransferErrDisabled =>
      'El PC no permite enviar ni descargar ficheros';

  @override
  String get remoteTransferErrNotFound => 'No existe';

  @override
  String get remoteTransferErrDenied => 'Sin permiso';

  @override
  String get remoteTransferErrIsDirectory => 'Es una carpeta';

  @override
  String get remoteTransferErrIo => 'Error al leer o escribir';

  @override
  String get remoteTransferErrBusy => 'Ya está en curso';

  @override
  String get remoteTransferErrIntegrity => 'Ha llegado dañado';

  @override
  String get remoteTransferErrSize => 'El tamaño no coincide';

  @override
  String get remoteTransferErrConnectionLost => 'Se perdió la conexión';

  @override
  String get remoteTransferErrRead => 'No se ha podido leer el fichero';

  @override
  String remoteTransferErrOther(String code) {
    return 'Error ($code)';
  }

  @override
  String get remoteStreamQuality => 'Calidad de vídeo';

  @override
  String get remoteStreamBalanced => 'Equilibrado';

  @override
  String get remoteStreamSmooth => 'Fluido';

  @override
  String get remoteStreamNative => 'Resolución original';

  @override
  String get remoteStreamBuffer => 'Búfer de vídeo';
}
