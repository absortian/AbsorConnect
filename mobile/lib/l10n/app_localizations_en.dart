// ignore: unused_import
import 'package:intl/intl.dart' as intl;

import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get appTitle => 'Absor Connect';

  @override
  String get authSubtitle =>
      'Sign in to have your connections on all your devices.';

  @override
  String get authLogin => 'Sign in';

  @override
  String get authRegister => 'Create account';

  @override
  String get authEmail => 'Email';

  @override
  String get authPassword => 'Password';

  @override
  String get authConfirmPassword => 'Repeat the password';

  @override
  String get authPasswordHint => 'At least 10 characters.';

  @override
  String get authExpired =>
      'Your session has expired or was closed elsewhere. Please sign in again.';

  @override
  String get connectionsTitle => 'Connections';

  @override
  String get connectionsEmpty => 'No connections yet.';

  @override
  String get connectionsEmptyHint =>
      'Tap + to add an S3 or SSH connection. Connections created on your computer appear here too.';

  @override
  String get connectionsConflict =>
      'Another device changed your connections. The current list has been loaded and your last change was not saved: please repeat it.';

  @override
  String saveFailed(String reason) {
    return 'The change could not be saved: $reason';
  }

  @override
  String loadFailed(String reason) {
    return 'Your connections could not be loaded: $reason';
  }

  @override
  String get retry => 'Retry';

  @override
  String get credentialsUnavailable =>
      'The saved credentials of this connection are not available. Edit it to enter them again.';

  @override
  String get addConnection => 'New connection';

  @override
  String get addFolder => 'New folder';

  @override
  String get editConnection => 'Edit connection';

  @override
  String get folderName => 'Folder name';

  @override
  String get typeS3 => 'S3';

  @override
  String get typeSsh => 'SSH / SFTP';

  @override
  String get connectionName => 'Connection name';

  @override
  String get folder => 'Folder';

  @override
  String get folderNone => 'None';

  @override
  String get endpoint => 'Endpoint URL';

  @override
  String get region => 'Region';

  @override
  String get accessKeyId => 'Access Key ID';

  @override
  String get secretAccessKey => 'Secret Access Key';

  @override
  String get defaultBucket => 'Default bucket (optional)';

  @override
  String get host => 'Host';

  @override
  String get port => 'Port';

  @override
  String get username => 'Username';

  @override
  String get authMethod => 'Authentication';

  @override
  String get authMethodPassword => 'Password';

  @override
  String get authMethodKey => 'Private key';

  @override
  String get password => 'Password';

  @override
  String get privateKey => 'Private key';

  @override
  String get importKey => 'Import key file';

  @override
  String keyImported(String name) {
    return 'Key imported: $name';
  }

  @override
  String get keyNotImported => 'No key imported on this device';

  @override
  String get keyStaysHere =>
      'The key stays on this device: only its file name is saved in your account.';

  @override
  String get keyInvalid =>
      'That file is not a valid private key, or the passphrase is wrong.';

  @override
  String get passphrase => 'Passphrase (optional)';

  @override
  String get initialPath => 'Initial directory (optional)';

  @override
  String get required => 'Required';

  @override
  String get invalidPort => 'Port between 1 and 65535';

  @override
  String get keepUnavailable =>
      'Leave the secret fields empty to keep the saved credentials.';

  @override
  String get save => 'Save';

  @override
  String get cancel => 'Cancel';

  @override
  String get delete => 'Delete';

  @override
  String get edit => 'Edit';

  @override
  String get moveTo => 'Move to folder';

  @override
  String get root => 'No folder';

  @override
  String get openTerminal => 'Open terminal';

  @override
  String get openFiles => 'Browse files';

  @override
  String deleteConnectionConfirm(String name) {
    return 'Delete \"$name\"?';
  }

  @override
  String get deleteFolderConfirm =>
      'The folder and everything inside it will be deleted from your account on all your devices.';

  @override
  String get deleteConnectionBody =>
      'The connection will be deleted from your account on all your devices.';

  @override
  String get upload => 'Upload';

  @override
  String get uploadFromFiles => 'From Files';

  @override
  String get uploadFromPhotos => 'From Photos';

  @override
  String get newRemoteFolder => 'New folder';

  @override
  String get download => 'Download and share';

  @override
  String deleteItemConfirm(String name) {
    return 'Delete \"$name\"?';
  }

  @override
  String get deleteItemFolderBody =>
      'The folder will be deleted with all its contents.';

  @override
  String get deleteItemBody => 'This cannot be undone.';

  @override
  String get emptyFolder => 'This folder is empty.';

  @override
  String get buckets => 'Buckets';

  @override
  String get refresh => 'Refresh';

  @override
  String get transfers => 'Transfers';

  @override
  String get transferUploading => 'Uploading';

  @override
  String get transferDownloading => 'Downloading';

  @override
  String get transferDone => 'Done';

  @override
  String transferFailed(String reason) {
    return 'Failed: $reason';
  }

  @override
  String get share => 'Share';

  @override
  String get clearFinished => 'Clear finished';

  @override
  String get terminals => 'Terminals';

  @override
  String get noTerminals =>
      'No open terminals. Open one from an SSH connection.';

  @override
  String get reconnect => 'Reconnect';

  @override
  String get closeTerminal => 'Close terminal';

  @override
  String get terminalClosed => 'The session ended.';

  @override
  String get terminalConnecting => 'Connecting…';

  @override
  String get settings => 'Settings';

  @override
  String get signedInAs => 'Signed in as';

  @override
  String get logout => 'Sign out';

  @override
  String version(String version) {
    return 'Version $version';
  }

  @override
  String get checkUpdates => 'Check for updates';

  @override
  String get upToDate => 'You have the latest version.';

  @override
  String updateAvailable(String version) {
    return 'Version $version is available.';
  }

  @override
  String get updateDownload => 'Download';

  @override
  String get website => 'Website and help';

  @override
  String get keyMissingTitle => 'Import the private key';

  @override
  String keyMissingBody(String name) {
    return 'This connection uses the private key \"$name\". Import that file on this device to connect; it will stay only on this device.';
  }

  @override
  String get err_invalid_credentials => 'The email or password is incorrect.';

  @override
  String get err_email_taken =>
      'An account with that email already exists. Sign in instead.';

  @override
  String get err_email_invalid => 'The email is not valid.';

  @override
  String get err_password_too_short =>
      'The password must be at least 10 characters long.';

  @override
  String get err_password_too_long => 'The password is too long.';

  @override
  String get err_password_mismatch => 'The passwords do not match.';

  @override
  String get err_too_many_attempts =>
      'Too many attempts. Wait a little and try again.';

  @override
  String get err_network_error =>
      'Cannot reach the service. Check your internet connection.';

  @override
  String get err_server_error =>
      'The service is not available right now. Try again later.';

  @override
  String get err_connections_invalid =>
      'The service rejected the connection list.';

  @override
  String get err_ssh_auth_failed =>
      'Authentication failed: check the username, password or key.';

  @override
  String get err_ssh_unreachable =>
      'Cannot reach the server. Check the host, the port and your network.';

  @override
  String get err_ssh_timeout => 'The server took too long to answer.';

  @override
  String get err_ssh_key_missing =>
      'The private key is not imported on this device.';

  @override
  String get err_ssh_key_invalid =>
      'The private key could not be read (wrong passphrase?).';

  @override
  String get err_ssh_disconnected => 'The connection with the server was lost.';

  @override
  String err_sftp_error(String detail) {
    return 'The server rejected the operation: $detail';
  }

  @override
  String get err_s3_access_denied =>
      'Access denied: check the keys and permissions.';

  @override
  String get err_s3_not_found => 'The bucket or file does not exist.';

  @override
  String err_s3_error(String detail) {
    return 'The storage service returned an error: $detail';
  }

  @override
  String err_s3_redirect(String location) {
    return 'The server redirects to $location. Use that address as the endpoint.';
  }

  @override
  String err_s3_tls_error(String detail) {
    return 'Could not open a secure connection to the server (the certificate is invalid or not trusted by this phone): $detail';
  }

  @override
  String get err_s3_invalid_endpoint =>
      'The endpoint is not a valid address. Enter it in full, for example https://s3.example.com';

  @override
  String get err_unknown => 'Something went wrong. Please try again.';

  @override
  String get devicesTitle => 'Devices';

  @override
  String get devicesHint =>
      'The PCs in your account with Absor Connect. To control one, it has to be online with remote control turned on; you will be asked for its password.';

  @override
  String get devicesEmpty =>
      'There are no devices in your account yet. Turn on remote control in the desktop app\'s Settings.';

  @override
  String devicesLoadFailed(String reason) {
    return 'The device list could not be loaded: $reason';
  }

  @override
  String get deviceStateAvailable => 'Available';

  @override
  String get deviceStateBusy => 'Busy: another device is controlling it';

  @override
  String get deviceStateDisabled => 'Remote control off';

  @override
  String get deviceStateMissingPermissions => 'Missing system permissions';

  @override
  String get deviceStateUnsupported =>
      'Its system doesn\'t allow remote control';

  @override
  String get deviceStateOffline => 'Offline';

  @override
  String get remoteConnect => 'Connect';

  @override
  String remotePasswordTitle(String pc) {
    return 'Connect to $pc';
  }

  @override
  String get remotePasswordHint => 'Enter that PC\'s remote control password.';

  @override
  String get remotePassword => 'PC password';

  @override
  String get remoteConnecting => 'Connecting…';

  @override
  String get remoteWaitingPc => 'Waiting for the PC…';

  @override
  String get remoteAuthenticating => 'Checking the password…';

  @override
  String get remoteReconnecting => 'Connection lost. Reconnecting…';

  @override
  String get remoteDirect => 'Direct';

  @override
  String get remoteRelay => 'Via relay';

  @override
  String get remoteDisconnect => 'Disconnect';

  @override
  String get remoteReconnect => 'Reconnect';

  @override
  String get remoteBack => 'Back';

  @override
  String get remoteMouseMode => 'Mouse mode: your finger moves the pointer';

  @override
  String get remoteTouchMode => 'Touch mode: tap to click there';

  @override
  String get remoteKeyboard => 'Keyboard';

  @override
  String remoteDisplay(String number) {
    return 'Display $number';
  }

  @override
  String get remoteSendClipboard => 'Send clipboard to the PC';

  @override
  String get remoteClipboardSent => 'Clipboard sent to the PC.';

  @override
  String get remoteClipboardEmpty =>
      'There is no text in the phone\'s clipboard.';

  @override
  String get remoteMute => 'Mute';

  @override
  String get remoteUnmute => 'Unmute';

  @override
  String get remoteSendFile => 'Send file';

  @override
  String get remoteSendPhoto => 'Send photo or video';

  @override
  String get remoteDownload => 'Download from the PC';

  @override
  String get remoteTransfers => 'Transfers';

  @override
  String get remoteClearFinished => 'Clear finished';

  @override
  String remoteSentAs(String name) {
    return 'On the PC as “$name”';
  }

  @override
  String get remoteShare => 'Share';

  @override
  String get remoteQueued => 'Queued';

  @override
  String get remoteCancelled => 'Cancelled';

  @override
  String get remoteUp => 'Parent folder';

  @override
  String get remoteFolderEmpty => 'Empty folder';

  @override
  String get remoteTruncated => 'Only the first 5000 are shown.';

  @override
  String get remoteFeatureOff => 'The PC doesn\'t allow it in this session.';

  @override
  String get remoteClosedLocal => 'Disconnected from the PC.';

  @override
  String get remoteClosedDisabled => 'The PC turned remote control off.';

  @override
  String get remoteClosedPasswordChanged => 'The PC\'s password changed.';

  @override
  String get remoteClosedSignedOut => 'The PC signed out of the account.';

  @override
  String get remoteClosedStopped => 'The app on the PC was closed.';

  @override
  String get remoteClosedCaptureFailed =>
      'The PC couldn\'t capture its screen.';

  @override
  String get remoteClosedBackground =>
      'The session was closed because the app spent more than 30 seconds in the background.';

  @override
  String get remoteClosedOther => 'The PC closed the session.';

  @override
  String get remoteErrWrongPassword => 'Wrong password.';

  @override
  String remoteErrLocked(String minutes) {
    return 'Too many failed attempts. The PC won\'t accept connections for $minutes min.';
  }

  @override
  String get remoteErrBusy =>
      'Another device is controlling that PC right now.';

  @override
  String get remoteErrDeviceOffline =>
      'The PC is not connected: the app isn\'t running or has no network.';

  @override
  String get remoteErrRemoteDisabled =>
      'Remote control is turned off on that PC.';

  @override
  String get remoteErrMissingPermissions =>
      'That PC is missing system permissions to be controlled.';

  @override
  String get remoteErrUnsupported =>
      'That PC can\'t be controlled right now: its system doesn\'t allow it (for example, Linux with Wayland) or it couldn\'t open the session.';

  @override
  String get remoteErrDeclined =>
      'The connection was declined on the PC, or nobody accepted it in time.';

  @override
  String get remoteErrConnectionFailed =>
      'The network doesn\'t allow connecting to that PC.';

  @override
  String get remoteErrNoAnswer => 'The PC didn\'t respond.';

  @override
  String get remoteErrReconnectFailed =>
      'The connection couldn\'t be recovered.';

  @override
  String remoteErrTooManyRequests(String seconds) {
    return 'Too many requests. Try again in $seconds s.';
  }

  @override
  String get remoteErrUnavailable =>
      'Remote control isn\'t available on the service right now.';

  @override
  String get remoteErrDeviceNotFound => 'That PC is no longer in the account.';

  @override
  String remoteErrOther(String code) {
    return 'Couldn\'t connect ($code).';
  }

  @override
  String get remoteTransferErrDisabled =>
      'The PC doesn\'t allow sending or downloading files';

  @override
  String get remoteTransferErrNotFound => 'Doesn\'t exist';

  @override
  String get remoteTransferErrDenied => 'Permission denied';

  @override
  String get remoteTransferErrIsDirectory => 'It\'s a folder';

  @override
  String get remoteTransferErrIo => 'Read or write error';

  @override
  String get remoteTransferErrBusy => 'Already in progress';

  @override
  String get remoteTransferErrIntegrity => 'It arrived damaged';

  @override
  String get remoteTransferErrSize => 'The size doesn\'t match';

  @override
  String get remoteTransferErrConnectionLost => 'The connection was lost';

  @override
  String get remoteTransferErrRead => 'The file couldn\'t be read';

  @override
  String remoteTransferErrOther(String code) {
    return 'Error ($code)';
  }

  @override
  String get remoteStreamQuality => 'Video quality';

  @override
  String get remoteStreamBalanced => 'Balanced';

  @override
  String get remoteStreamSmooth => 'Smooth';

  @override
  String get remoteStreamNative => 'Original resolution';

  @override
  String get remoteStreamBuffer => 'Video buffer';

  @override
  String get remoteAgentDesktop => 'User desktop';

  @override
  String get remoteAgentLocked => 'Device locked';

  @override
  String get remoteAgentLogin => 'Sign in';

  @override
  String get remoteAgentPrompt => 'System authorization';

  @override
  String get remoteAgentTransition => 'Changing context';

  @override
  String get remoteAgentUnavailable => 'Context unavailable';

  @override
  String get remoteAgentImageMissing =>
      'There is no current image. The previous image is hidden.';

  @override
  String get remoteAgentImageWaiting =>
      'Waiting for a new frame from the current context.';

  @override
  String get remoteAgentInputUnavailable =>
      'The host does not support input in this context. Sensitive features are suspended.';

  @override
  String get remoteAgentReconnectContent =>
      'Files, clipboard and sound remain suspended until you reconnect.';

  @override
  String get remoteAgentSensitiveSuspended =>
      'Protected context: clipboard, files and sound are suspended.';
}
