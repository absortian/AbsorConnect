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
}
