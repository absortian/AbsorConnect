import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'app_localizations_en.dart';
import 'app_localizations_es.dart';

// ignore_for_file: type=lint

/// Callers can lookup localized strings with an instance of AppLocalizations
/// returned by `AppLocalizations.of(context)`.
///
/// Applications need to include `AppLocalizations.delegate()` in their app's
/// `localizationDelegates` list, and the locales they support in the app's
/// `supportedLocales` list. For example:
///
/// ```dart
/// import 'l10n/app_localizations.dart';
///
/// return MaterialApp(
///   localizationsDelegates: AppLocalizations.localizationsDelegates,
///   supportedLocales: AppLocalizations.supportedLocales,
///   home: MyApplicationHome(),
/// );
/// ```
///
/// ## Update pubspec.yaml
///
/// Please make sure to update your pubspec.yaml to include the following
/// packages:
///
/// ```yaml
/// dependencies:
///   # Internationalization support.
///   flutter_localizations:
///     sdk: flutter
///   intl: any # Use the pinned version from flutter_localizations
///
///   # Rest of dependencies
/// ```
///
/// ## iOS Applications
///
/// iOS applications define key application metadata, including supported
/// locales, in an Info.plist file that is built into the application bundle.
/// To configure the locales supported by your app, you’ll need to edit this
/// file.
///
/// First, open your project’s ios/Runner.xcworkspace Xcode workspace file.
/// Then, in the Project Navigator, open the Info.plist file under the Runner
/// project’s Runner folder.
///
/// Next, select the Information Property List item, select Add Item from the
/// Editor menu, then select Localizations from the pop-up menu.
///
/// Select and expand the newly-created Localizations item then, for each
/// locale your application supports, add a new item and select the locale
/// you wish to add from the pop-up menu in the Value field. This list should
/// be consistent with the languages listed in the AppLocalizations.supportedLocales
/// property.
abstract class AppLocalizations {
  AppLocalizations(String locale)
    : localeName = intl.Intl.canonicalizedLocale(locale.toString());

  final String localeName;

  static AppLocalizations of(BuildContext context) {
    return Localizations.of<AppLocalizations>(context, AppLocalizations)!;
  }

  static const LocalizationsDelegate<AppLocalizations> delegate =
      _AppLocalizationsDelegate();

  /// A list of this localizations delegate along with the default localizations
  /// delegates.
  ///
  /// Returns a list of localizations delegates containing this delegate along with
  /// GlobalMaterialLocalizations.delegate, GlobalCupertinoLocalizations.delegate,
  /// and GlobalWidgetsLocalizations.delegate.
  ///
  /// Additional delegates can be added by appending to this list in
  /// MaterialApp. This list does not have to be used at all if a custom list
  /// of delegates is preferred or required.
  static const List<LocalizationsDelegate<dynamic>> localizationsDelegates =
      <LocalizationsDelegate<dynamic>>[
        delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ];

  /// A list of this localizations delegate's supported locales.
  static const List<Locale> supportedLocales = <Locale>[
    Locale('en'),
    Locale('es'),
  ];

  /// No description provided for @appTitle.
  ///
  /// In en, this message translates to:
  /// **'Absor Connect'**
  String get appTitle;

  /// No description provided for @authSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Sign in to have your connections on all your devices.'**
  String get authSubtitle;

  /// No description provided for @authLogin.
  ///
  /// In en, this message translates to:
  /// **'Sign in'**
  String get authLogin;

  /// No description provided for @authRegister.
  ///
  /// In en, this message translates to:
  /// **'Create account'**
  String get authRegister;

  /// No description provided for @authEmail.
  ///
  /// In en, this message translates to:
  /// **'Email'**
  String get authEmail;

  /// No description provided for @authPassword.
  ///
  /// In en, this message translates to:
  /// **'Password'**
  String get authPassword;

  /// No description provided for @authConfirmPassword.
  ///
  /// In en, this message translates to:
  /// **'Repeat the password'**
  String get authConfirmPassword;

  /// No description provided for @authPasswordHint.
  ///
  /// In en, this message translates to:
  /// **'At least 10 characters.'**
  String get authPasswordHint;

  /// No description provided for @authExpired.
  ///
  /// In en, this message translates to:
  /// **'Your session has expired or was closed elsewhere. Please sign in again.'**
  String get authExpired;

  /// No description provided for @connectionsTitle.
  ///
  /// In en, this message translates to:
  /// **'Connections'**
  String get connectionsTitle;

  /// No description provided for @connectionsEmpty.
  ///
  /// In en, this message translates to:
  /// **'No connections yet.'**
  String get connectionsEmpty;

  /// No description provided for @connectionsEmptyHint.
  ///
  /// In en, this message translates to:
  /// **'Tap + to add an S3 or SSH connection. Connections created on your computer appear here too.'**
  String get connectionsEmptyHint;

  /// No description provided for @connectionsConflict.
  ///
  /// In en, this message translates to:
  /// **'Another device changed your connections. The current list has been loaded and your last change was not saved: please repeat it.'**
  String get connectionsConflict;

  /// No description provided for @saveFailed.
  ///
  /// In en, this message translates to:
  /// **'The change could not be saved: {reason}'**
  String saveFailed(String reason);

  /// No description provided for @loadFailed.
  ///
  /// In en, this message translates to:
  /// **'Your connections could not be loaded: {reason}'**
  String loadFailed(String reason);

  /// No description provided for @retry.
  ///
  /// In en, this message translates to:
  /// **'Retry'**
  String get retry;

  /// No description provided for @credentialsUnavailable.
  ///
  /// In en, this message translates to:
  /// **'The saved credentials of this connection are not available. Edit it to enter them again.'**
  String get credentialsUnavailable;

  /// No description provided for @addConnection.
  ///
  /// In en, this message translates to:
  /// **'New connection'**
  String get addConnection;

  /// No description provided for @addFolder.
  ///
  /// In en, this message translates to:
  /// **'New folder'**
  String get addFolder;

  /// No description provided for @editConnection.
  ///
  /// In en, this message translates to:
  /// **'Edit connection'**
  String get editConnection;

  /// No description provided for @folderName.
  ///
  /// In en, this message translates to:
  /// **'Folder name'**
  String get folderName;

  /// No description provided for @typeS3.
  ///
  /// In en, this message translates to:
  /// **'S3'**
  String get typeS3;

  /// No description provided for @typeSsh.
  ///
  /// In en, this message translates to:
  /// **'SSH / SFTP'**
  String get typeSsh;

  /// No description provided for @connectionName.
  ///
  /// In en, this message translates to:
  /// **'Connection name'**
  String get connectionName;

  /// No description provided for @folder.
  ///
  /// In en, this message translates to:
  /// **'Folder'**
  String get folder;

  /// No description provided for @folderNone.
  ///
  /// In en, this message translates to:
  /// **'None'**
  String get folderNone;

  /// No description provided for @endpoint.
  ///
  /// In en, this message translates to:
  /// **'Endpoint URL'**
  String get endpoint;

  /// No description provided for @region.
  ///
  /// In en, this message translates to:
  /// **'Region'**
  String get region;

  /// No description provided for @accessKeyId.
  ///
  /// In en, this message translates to:
  /// **'Access Key ID'**
  String get accessKeyId;

  /// No description provided for @secretAccessKey.
  ///
  /// In en, this message translates to:
  /// **'Secret Access Key'**
  String get secretAccessKey;

  /// No description provided for @defaultBucket.
  ///
  /// In en, this message translates to:
  /// **'Default bucket (optional)'**
  String get defaultBucket;

  /// No description provided for @host.
  ///
  /// In en, this message translates to:
  /// **'Host'**
  String get host;

  /// No description provided for @port.
  ///
  /// In en, this message translates to:
  /// **'Port'**
  String get port;

  /// No description provided for @username.
  ///
  /// In en, this message translates to:
  /// **'Username'**
  String get username;

  /// No description provided for @authMethod.
  ///
  /// In en, this message translates to:
  /// **'Authentication'**
  String get authMethod;

  /// No description provided for @authMethodPassword.
  ///
  /// In en, this message translates to:
  /// **'Password'**
  String get authMethodPassword;

  /// No description provided for @authMethodKey.
  ///
  /// In en, this message translates to:
  /// **'Private key'**
  String get authMethodKey;

  /// No description provided for @password.
  ///
  /// In en, this message translates to:
  /// **'Password'**
  String get password;

  /// No description provided for @privateKey.
  ///
  /// In en, this message translates to:
  /// **'Private key'**
  String get privateKey;

  /// No description provided for @importKey.
  ///
  /// In en, this message translates to:
  /// **'Import key file'**
  String get importKey;

  /// No description provided for @keyImported.
  ///
  /// In en, this message translates to:
  /// **'Key imported: {name}'**
  String keyImported(String name);

  /// No description provided for @keyNotImported.
  ///
  /// In en, this message translates to:
  /// **'No key imported on this device'**
  String get keyNotImported;

  /// No description provided for @keyStaysHere.
  ///
  /// In en, this message translates to:
  /// **'The key stays on this device: only its file name is saved in your account.'**
  String get keyStaysHere;

  /// No description provided for @keyInvalid.
  ///
  /// In en, this message translates to:
  /// **'That file is not a valid private key, or the passphrase is wrong.'**
  String get keyInvalid;

  /// No description provided for @passphrase.
  ///
  /// In en, this message translates to:
  /// **'Passphrase (optional)'**
  String get passphrase;

  /// No description provided for @initialPath.
  ///
  /// In en, this message translates to:
  /// **'Initial directory (optional)'**
  String get initialPath;

  /// No description provided for @required.
  ///
  /// In en, this message translates to:
  /// **'Required'**
  String get required;

  /// No description provided for @invalidPort.
  ///
  /// In en, this message translates to:
  /// **'Port between 1 and 65535'**
  String get invalidPort;

  /// No description provided for @keepUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Leave the secret fields empty to keep the saved credentials.'**
  String get keepUnavailable;

  /// No description provided for @save.
  ///
  /// In en, this message translates to:
  /// **'Save'**
  String get save;

  /// No description provided for @cancel.
  ///
  /// In en, this message translates to:
  /// **'Cancel'**
  String get cancel;

  /// No description provided for @delete.
  ///
  /// In en, this message translates to:
  /// **'Delete'**
  String get delete;

  /// No description provided for @edit.
  ///
  /// In en, this message translates to:
  /// **'Edit'**
  String get edit;

  /// No description provided for @moveTo.
  ///
  /// In en, this message translates to:
  /// **'Move to folder'**
  String get moveTo;

  /// No description provided for @root.
  ///
  /// In en, this message translates to:
  /// **'No folder'**
  String get root;

  /// No description provided for @openTerminal.
  ///
  /// In en, this message translates to:
  /// **'Open terminal'**
  String get openTerminal;

  /// No description provided for @openFiles.
  ///
  /// In en, this message translates to:
  /// **'Browse files'**
  String get openFiles;

  /// No description provided for @deleteConnectionConfirm.
  ///
  /// In en, this message translates to:
  /// **'Delete \"{name}\"?'**
  String deleteConnectionConfirm(String name);

  /// No description provided for @deleteFolderConfirm.
  ///
  /// In en, this message translates to:
  /// **'The folder and everything inside it will be deleted from your account on all your devices.'**
  String get deleteFolderConfirm;

  /// No description provided for @deleteConnectionBody.
  ///
  /// In en, this message translates to:
  /// **'The connection will be deleted from your account on all your devices.'**
  String get deleteConnectionBody;

  /// No description provided for @upload.
  ///
  /// In en, this message translates to:
  /// **'Upload'**
  String get upload;

  /// No description provided for @uploadFromFiles.
  ///
  /// In en, this message translates to:
  /// **'From Files'**
  String get uploadFromFiles;

  /// No description provided for @uploadFromPhotos.
  ///
  /// In en, this message translates to:
  /// **'From Photos'**
  String get uploadFromPhotos;

  /// No description provided for @newRemoteFolder.
  ///
  /// In en, this message translates to:
  /// **'New folder'**
  String get newRemoteFolder;

  /// No description provided for @download.
  ///
  /// In en, this message translates to:
  /// **'Download and share'**
  String get download;

  /// No description provided for @deleteItemConfirm.
  ///
  /// In en, this message translates to:
  /// **'Delete \"{name}\"?'**
  String deleteItemConfirm(String name);

  /// No description provided for @deleteItemFolderBody.
  ///
  /// In en, this message translates to:
  /// **'The folder will be deleted with all its contents.'**
  String get deleteItemFolderBody;

  /// No description provided for @deleteItemBody.
  ///
  /// In en, this message translates to:
  /// **'This cannot be undone.'**
  String get deleteItemBody;

  /// No description provided for @emptyFolder.
  ///
  /// In en, this message translates to:
  /// **'This folder is empty.'**
  String get emptyFolder;

  /// No description provided for @buckets.
  ///
  /// In en, this message translates to:
  /// **'Buckets'**
  String get buckets;

  /// No description provided for @refresh.
  ///
  /// In en, this message translates to:
  /// **'Refresh'**
  String get refresh;

  /// No description provided for @transfers.
  ///
  /// In en, this message translates to:
  /// **'Transfers'**
  String get transfers;

  /// No description provided for @transferUploading.
  ///
  /// In en, this message translates to:
  /// **'Uploading'**
  String get transferUploading;

  /// No description provided for @transferDownloading.
  ///
  /// In en, this message translates to:
  /// **'Downloading'**
  String get transferDownloading;

  /// No description provided for @transferDone.
  ///
  /// In en, this message translates to:
  /// **'Done'**
  String get transferDone;

  /// No description provided for @transferFailed.
  ///
  /// In en, this message translates to:
  /// **'Failed: {reason}'**
  String transferFailed(String reason);

  /// No description provided for @share.
  ///
  /// In en, this message translates to:
  /// **'Share'**
  String get share;

  /// No description provided for @clearFinished.
  ///
  /// In en, this message translates to:
  /// **'Clear finished'**
  String get clearFinished;

  /// No description provided for @terminals.
  ///
  /// In en, this message translates to:
  /// **'Terminals'**
  String get terminals;

  /// No description provided for @noTerminals.
  ///
  /// In en, this message translates to:
  /// **'No open terminals. Open one from an SSH connection.'**
  String get noTerminals;

  /// No description provided for @reconnect.
  ///
  /// In en, this message translates to:
  /// **'Reconnect'**
  String get reconnect;

  /// No description provided for @closeTerminal.
  ///
  /// In en, this message translates to:
  /// **'Close terminal'**
  String get closeTerminal;

  /// No description provided for @terminalClosed.
  ///
  /// In en, this message translates to:
  /// **'The session ended.'**
  String get terminalClosed;

  /// No description provided for @terminalConnecting.
  ///
  /// In en, this message translates to:
  /// **'Connecting…'**
  String get terminalConnecting;

  /// No description provided for @settings.
  ///
  /// In en, this message translates to:
  /// **'Settings'**
  String get settings;

  /// No description provided for @signedInAs.
  ///
  /// In en, this message translates to:
  /// **'Signed in as'**
  String get signedInAs;

  /// No description provided for @logout.
  ///
  /// In en, this message translates to:
  /// **'Sign out'**
  String get logout;

  /// No description provided for @version.
  ///
  /// In en, this message translates to:
  /// **'Version {version}'**
  String version(String version);

  /// No description provided for @checkUpdates.
  ///
  /// In en, this message translates to:
  /// **'Check for updates'**
  String get checkUpdates;

  /// No description provided for @upToDate.
  ///
  /// In en, this message translates to:
  /// **'You have the latest version.'**
  String get upToDate;

  /// No description provided for @updateAvailable.
  ///
  /// In en, this message translates to:
  /// **'Version {version} is available.'**
  String updateAvailable(String version);

  /// No description provided for @updateDownload.
  ///
  /// In en, this message translates to:
  /// **'Download'**
  String get updateDownload;

  /// No description provided for @website.
  ///
  /// In en, this message translates to:
  /// **'Website and help'**
  String get website;

  /// No description provided for @keyMissingTitle.
  ///
  /// In en, this message translates to:
  /// **'Import the private key'**
  String get keyMissingTitle;

  /// No description provided for @keyMissingBody.
  ///
  /// In en, this message translates to:
  /// **'This connection uses the private key \"{name}\". Import that file on this device to connect; it will stay only on this device.'**
  String keyMissingBody(String name);

  /// No description provided for @err_invalid_credentials.
  ///
  /// In en, this message translates to:
  /// **'The email or password is incorrect.'**
  String get err_invalid_credentials;

  /// No description provided for @err_email_taken.
  ///
  /// In en, this message translates to:
  /// **'An account with that email already exists. Sign in instead.'**
  String get err_email_taken;

  /// No description provided for @err_email_invalid.
  ///
  /// In en, this message translates to:
  /// **'The email is not valid.'**
  String get err_email_invalid;

  /// No description provided for @err_password_too_short.
  ///
  /// In en, this message translates to:
  /// **'The password must be at least 10 characters long.'**
  String get err_password_too_short;

  /// No description provided for @err_password_too_long.
  ///
  /// In en, this message translates to:
  /// **'The password is too long.'**
  String get err_password_too_long;

  /// No description provided for @err_password_mismatch.
  ///
  /// In en, this message translates to:
  /// **'The passwords do not match.'**
  String get err_password_mismatch;

  /// No description provided for @err_too_many_attempts.
  ///
  /// In en, this message translates to:
  /// **'Too many attempts. Wait a little and try again.'**
  String get err_too_many_attempts;

  /// No description provided for @err_network_error.
  ///
  /// In en, this message translates to:
  /// **'Cannot reach the service. Check your internet connection.'**
  String get err_network_error;

  /// No description provided for @err_server_error.
  ///
  /// In en, this message translates to:
  /// **'The service is not available right now. Try again later.'**
  String get err_server_error;

  /// No description provided for @err_connections_invalid.
  ///
  /// In en, this message translates to:
  /// **'The service rejected the connection list.'**
  String get err_connections_invalid;

  /// No description provided for @err_ssh_auth_failed.
  ///
  /// In en, this message translates to:
  /// **'Authentication failed: check the username, password or key.'**
  String get err_ssh_auth_failed;

  /// No description provided for @err_ssh_unreachable.
  ///
  /// In en, this message translates to:
  /// **'Cannot reach the server. Check the host, the port and your network.'**
  String get err_ssh_unreachable;

  /// No description provided for @err_ssh_timeout.
  ///
  /// In en, this message translates to:
  /// **'The server took too long to answer.'**
  String get err_ssh_timeout;

  /// No description provided for @err_ssh_key_missing.
  ///
  /// In en, this message translates to:
  /// **'The private key is not imported on this device.'**
  String get err_ssh_key_missing;

  /// No description provided for @err_ssh_key_invalid.
  ///
  /// In en, this message translates to:
  /// **'The private key could not be read (wrong passphrase?).'**
  String get err_ssh_key_invalid;

  /// No description provided for @err_ssh_disconnected.
  ///
  /// In en, this message translates to:
  /// **'The connection with the server was lost.'**
  String get err_ssh_disconnected;

  /// No description provided for @err_sftp_error.
  ///
  /// In en, this message translates to:
  /// **'The server rejected the operation: {detail}'**
  String err_sftp_error(String detail);

  /// No description provided for @err_s3_access_denied.
  ///
  /// In en, this message translates to:
  /// **'Access denied: check the keys and permissions.'**
  String get err_s3_access_denied;

  /// No description provided for @err_s3_not_found.
  ///
  /// In en, this message translates to:
  /// **'The bucket or file does not exist.'**
  String get err_s3_not_found;

  /// No description provided for @err_s3_error.
  ///
  /// In en, this message translates to:
  /// **'The storage service returned an error: {detail}'**
  String err_s3_error(String detail);

  /// No description provided for @err_s3_redirect.
  ///
  /// In en, this message translates to:
  /// **'The server redirects to {location}. Use that address as the endpoint.'**
  String err_s3_redirect(String location);

  /// No description provided for @err_s3_tls_error.
  ///
  /// In en, this message translates to:
  /// **'Could not open a secure connection to the server (the certificate is invalid or not trusted by this phone): {detail}'**
  String err_s3_tls_error(String detail);

  /// No description provided for @err_s3_invalid_endpoint.
  ///
  /// In en, this message translates to:
  /// **'The endpoint is not a valid address. Enter it in full, for example https://s3.example.com'**
  String get err_s3_invalid_endpoint;

  /// No description provided for @err_unknown.
  ///
  /// In en, this message translates to:
  /// **'Something went wrong. Please try again.'**
  String get err_unknown;

  /// No description provided for @devicesTitle.
  ///
  /// In en, this message translates to:
  /// **'Devices'**
  String get devicesTitle;

  /// No description provided for @devicesHint.
  ///
  /// In en, this message translates to:
  /// **'The PCs in your account with Absor Connect. To control one, it has to be online with remote control turned on; you will be asked for its password.'**
  String get devicesHint;

  /// No description provided for @devicesEmpty.
  ///
  /// In en, this message translates to:
  /// **'There are no devices in your account yet. Turn on remote control in the desktop app\'s Settings.'**
  String get devicesEmpty;

  /// No description provided for @devicesLoadFailed.
  ///
  /// In en, this message translates to:
  /// **'The device list could not be loaded: {reason}'**
  String devicesLoadFailed(String reason);

  /// No description provided for @deviceStateAvailable.
  ///
  /// In en, this message translates to:
  /// **'Available'**
  String get deviceStateAvailable;

  /// No description provided for @deviceStateBusy.
  ///
  /// In en, this message translates to:
  /// **'Busy: another device is controlling it'**
  String get deviceStateBusy;

  /// No description provided for @deviceStateDisabled.
  ///
  /// In en, this message translates to:
  /// **'Remote control off'**
  String get deviceStateDisabled;

  /// No description provided for @deviceStateMissingPermissions.
  ///
  /// In en, this message translates to:
  /// **'Missing system permissions'**
  String get deviceStateMissingPermissions;

  /// No description provided for @deviceStateUnsupported.
  ///
  /// In en, this message translates to:
  /// **'Its system doesn\'t allow remote control'**
  String get deviceStateUnsupported;

  /// No description provided for @deviceStateOffline.
  ///
  /// In en, this message translates to:
  /// **'Offline'**
  String get deviceStateOffline;

  /// No description provided for @remoteConnect.
  ///
  /// In en, this message translates to:
  /// **'Connect'**
  String get remoteConnect;

  /// No description provided for @remotePasswordTitle.
  ///
  /// In en, this message translates to:
  /// **'Connect to {pc}'**
  String remotePasswordTitle(String pc);

  /// No description provided for @remotePasswordHint.
  ///
  /// In en, this message translates to:
  /// **'Enter that PC\'s remote control password.'**
  String get remotePasswordHint;

  /// No description provided for @remotePassword.
  ///
  /// In en, this message translates to:
  /// **'PC password'**
  String get remotePassword;

  /// No description provided for @remoteConnecting.
  ///
  /// In en, this message translates to:
  /// **'Connecting…'**
  String get remoteConnecting;

  /// No description provided for @remoteWaitingPc.
  ///
  /// In en, this message translates to:
  /// **'Waiting for the PC…'**
  String get remoteWaitingPc;

  /// No description provided for @remoteAuthenticating.
  ///
  /// In en, this message translates to:
  /// **'Checking the password…'**
  String get remoteAuthenticating;

  /// No description provided for @remoteReconnecting.
  ///
  /// In en, this message translates to:
  /// **'Connection lost. Reconnecting…'**
  String get remoteReconnecting;

  /// No description provided for @remoteDirect.
  ///
  /// In en, this message translates to:
  /// **'Direct'**
  String get remoteDirect;

  /// No description provided for @remoteRelay.
  ///
  /// In en, this message translates to:
  /// **'Via relay'**
  String get remoteRelay;

  /// No description provided for @remoteDisconnect.
  ///
  /// In en, this message translates to:
  /// **'Disconnect'**
  String get remoteDisconnect;

  /// No description provided for @remoteReconnect.
  ///
  /// In en, this message translates to:
  /// **'Reconnect'**
  String get remoteReconnect;

  /// No description provided for @remoteBack.
  ///
  /// In en, this message translates to:
  /// **'Back'**
  String get remoteBack;

  /// No description provided for @remoteMouseMode.
  ///
  /// In en, this message translates to:
  /// **'Mouse mode: your finger moves the pointer'**
  String get remoteMouseMode;

  /// No description provided for @remoteTouchMode.
  ///
  /// In en, this message translates to:
  /// **'Touch mode: tap to click there'**
  String get remoteTouchMode;

  /// No description provided for @remoteKeyboard.
  ///
  /// In en, this message translates to:
  /// **'Keyboard'**
  String get remoteKeyboard;

  /// No description provided for @remoteDisplay.
  ///
  /// In en, this message translates to:
  /// **'Display {number}'**
  String remoteDisplay(String number);

  /// No description provided for @remoteSendClipboard.
  ///
  /// In en, this message translates to:
  /// **'Send clipboard to the PC'**
  String get remoteSendClipboard;

  /// No description provided for @remoteClipboardSent.
  ///
  /// In en, this message translates to:
  /// **'Clipboard sent to the PC.'**
  String get remoteClipboardSent;

  /// No description provided for @remoteClipboardEmpty.
  ///
  /// In en, this message translates to:
  /// **'There is no text in the phone\'s clipboard.'**
  String get remoteClipboardEmpty;

  /// No description provided for @remoteMute.
  ///
  /// In en, this message translates to:
  /// **'Mute'**
  String get remoteMute;

  /// No description provided for @remoteUnmute.
  ///
  /// In en, this message translates to:
  /// **'Unmute'**
  String get remoteUnmute;

  /// No description provided for @remoteSendFile.
  ///
  /// In en, this message translates to:
  /// **'Send file'**
  String get remoteSendFile;

  /// No description provided for @remoteSendPhoto.
  ///
  /// In en, this message translates to:
  /// **'Send photo or video'**
  String get remoteSendPhoto;

  /// No description provided for @remoteDownload.
  ///
  /// In en, this message translates to:
  /// **'Download from the PC'**
  String get remoteDownload;

  /// No description provided for @remoteTransfers.
  ///
  /// In en, this message translates to:
  /// **'Transfers'**
  String get remoteTransfers;

  /// No description provided for @remoteClearFinished.
  ///
  /// In en, this message translates to:
  /// **'Clear finished'**
  String get remoteClearFinished;

  /// No description provided for @remoteSentAs.
  ///
  /// In en, this message translates to:
  /// **'On the PC as “{name}”'**
  String remoteSentAs(String name);

  /// No description provided for @remoteShare.
  ///
  /// In en, this message translates to:
  /// **'Share'**
  String get remoteShare;

  /// No description provided for @remoteQueued.
  ///
  /// In en, this message translates to:
  /// **'Queued'**
  String get remoteQueued;

  /// No description provided for @remoteCancelled.
  ///
  /// In en, this message translates to:
  /// **'Cancelled'**
  String get remoteCancelled;

  /// No description provided for @remoteUp.
  ///
  /// In en, this message translates to:
  /// **'Parent folder'**
  String get remoteUp;

  /// No description provided for @remoteFolderEmpty.
  ///
  /// In en, this message translates to:
  /// **'Empty folder'**
  String get remoteFolderEmpty;

  /// No description provided for @remoteTruncated.
  ///
  /// In en, this message translates to:
  /// **'Only the first 5000 are shown.'**
  String get remoteTruncated;

  /// No description provided for @remoteFeatureOff.
  ///
  /// In en, this message translates to:
  /// **'The PC doesn\'t allow it in this session.'**
  String get remoteFeatureOff;

  /// No description provided for @remoteClosedLocal.
  ///
  /// In en, this message translates to:
  /// **'Disconnected from the PC.'**
  String get remoteClosedLocal;

  /// No description provided for @remoteClosedDisabled.
  ///
  /// In en, this message translates to:
  /// **'The PC turned remote control off.'**
  String get remoteClosedDisabled;

  /// No description provided for @remoteClosedPasswordChanged.
  ///
  /// In en, this message translates to:
  /// **'The PC\'s password changed.'**
  String get remoteClosedPasswordChanged;

  /// No description provided for @remoteClosedSignedOut.
  ///
  /// In en, this message translates to:
  /// **'The PC signed out of the account.'**
  String get remoteClosedSignedOut;

  /// No description provided for @remoteClosedStopped.
  ///
  /// In en, this message translates to:
  /// **'The app on the PC was closed.'**
  String get remoteClosedStopped;

  /// No description provided for @remoteClosedCaptureFailed.
  ///
  /// In en, this message translates to:
  /// **'The PC couldn\'t capture its screen.'**
  String get remoteClosedCaptureFailed;

  /// No description provided for @remoteClosedBackground.
  ///
  /// In en, this message translates to:
  /// **'The session was closed because the app spent more than 30 seconds in the background.'**
  String get remoteClosedBackground;

  /// No description provided for @remoteClosedOther.
  ///
  /// In en, this message translates to:
  /// **'The PC closed the session.'**
  String get remoteClosedOther;

  /// No description provided for @remoteErrWrongPassword.
  ///
  /// In en, this message translates to:
  /// **'Wrong password.'**
  String get remoteErrWrongPassword;

  /// No description provided for @remoteErrLocked.
  ///
  /// In en, this message translates to:
  /// **'Too many failed attempts. The PC won\'t accept connections for {minutes} min.'**
  String remoteErrLocked(String minutes);

  /// No description provided for @remoteErrBusy.
  ///
  /// In en, this message translates to:
  /// **'Another device is controlling that PC right now.'**
  String get remoteErrBusy;

  /// No description provided for @remoteErrDeviceOffline.
  ///
  /// In en, this message translates to:
  /// **'The PC is not connected: the app isn\'t running or has no network.'**
  String get remoteErrDeviceOffline;

  /// No description provided for @remoteErrRemoteDisabled.
  ///
  /// In en, this message translates to:
  /// **'Remote control is turned off on that PC.'**
  String get remoteErrRemoteDisabled;

  /// No description provided for @remoteErrMissingPermissions.
  ///
  /// In en, this message translates to:
  /// **'That PC is missing system permissions to be controlled.'**
  String get remoteErrMissingPermissions;

  /// No description provided for @remoteErrUnsupported.
  ///
  /// In en, this message translates to:
  /// **'That PC can\'t be controlled right now: its system doesn\'t allow it (for example, Linux with Wayland) or it couldn\'t open the session.'**
  String get remoteErrUnsupported;

  /// No description provided for @remoteErrDeclined.
  ///
  /// In en, this message translates to:
  /// **'The connection was declined on the PC, or nobody accepted it in time.'**
  String get remoteErrDeclined;

  /// No description provided for @remoteErrConnectionFailed.
  ///
  /// In en, this message translates to:
  /// **'The network doesn\'t allow connecting to that PC.'**
  String get remoteErrConnectionFailed;

  /// No description provided for @remoteErrNoAnswer.
  ///
  /// In en, this message translates to:
  /// **'The PC didn\'t respond.'**
  String get remoteErrNoAnswer;

  /// No description provided for @remoteErrReconnectFailed.
  ///
  /// In en, this message translates to:
  /// **'The connection couldn\'t be recovered.'**
  String get remoteErrReconnectFailed;

  /// No description provided for @remoteErrTooManyRequests.
  ///
  /// In en, this message translates to:
  /// **'Too many requests. Try again in {seconds} s.'**
  String remoteErrTooManyRequests(String seconds);

  /// No description provided for @remoteErrUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Remote control isn\'t available on the service right now.'**
  String get remoteErrUnavailable;

  /// No description provided for @remoteErrDeviceNotFound.
  ///
  /// In en, this message translates to:
  /// **'That PC is no longer in the account.'**
  String get remoteErrDeviceNotFound;

  /// No description provided for @remoteErrOther.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t connect ({code}).'**
  String remoteErrOther(String code);

  /// No description provided for @remoteTransferErrDisabled.
  ///
  /// In en, this message translates to:
  /// **'The PC doesn\'t allow sending or downloading files'**
  String get remoteTransferErrDisabled;

  /// No description provided for @remoteTransferErrNotFound.
  ///
  /// In en, this message translates to:
  /// **'Doesn\'t exist'**
  String get remoteTransferErrNotFound;

  /// No description provided for @remoteTransferErrDenied.
  ///
  /// In en, this message translates to:
  /// **'Permission denied'**
  String get remoteTransferErrDenied;

  /// No description provided for @remoteTransferErrIsDirectory.
  ///
  /// In en, this message translates to:
  /// **'It\'s a folder'**
  String get remoteTransferErrIsDirectory;

  /// No description provided for @remoteTransferErrIo.
  ///
  /// In en, this message translates to:
  /// **'Read or write error'**
  String get remoteTransferErrIo;

  /// No description provided for @remoteTransferErrBusy.
  ///
  /// In en, this message translates to:
  /// **'Already in progress'**
  String get remoteTransferErrBusy;

  /// No description provided for @remoteTransferErrIntegrity.
  ///
  /// In en, this message translates to:
  /// **'It arrived damaged'**
  String get remoteTransferErrIntegrity;

  /// No description provided for @remoteTransferErrSize.
  ///
  /// In en, this message translates to:
  /// **'The size doesn\'t match'**
  String get remoteTransferErrSize;

  /// No description provided for @remoteTransferErrConnectionLost.
  ///
  /// In en, this message translates to:
  /// **'The connection was lost'**
  String get remoteTransferErrConnectionLost;

  /// No description provided for @remoteTransferErrRead.
  ///
  /// In en, this message translates to:
  /// **'The file couldn\'t be read'**
  String get remoteTransferErrRead;

  /// No description provided for @remoteTransferErrOther.
  ///
  /// In en, this message translates to:
  /// **'Error ({code})'**
  String remoteTransferErrOther(String code);

  /// No description provided for @remoteStreamQuality.
  ///
  /// In en, this message translates to:
  /// **'Video quality'**
  String get remoteStreamQuality;

  /// No description provided for @remoteStreamBalanced.
  ///
  /// In en, this message translates to:
  /// **'Balanced'**
  String get remoteStreamBalanced;

  /// No description provided for @remoteStreamSmooth.
  ///
  /// In en, this message translates to:
  /// **'Smooth'**
  String get remoteStreamSmooth;

  /// No description provided for @remoteStreamNative.
  ///
  /// In en, this message translates to:
  /// **'Original resolution'**
  String get remoteStreamNative;

  /// No description provided for @remoteStreamBuffer.
  ///
  /// In en, this message translates to:
  /// **'Video buffer'**
  String get remoteStreamBuffer;

  /// No description provided for @remoteAgentDesktop.
  ///
  /// In en, this message translates to:
  /// **'User desktop'**
  String get remoteAgentDesktop;

  /// No description provided for @remoteAgentLocked.
  ///
  /// In en, this message translates to:
  /// **'Device locked'**
  String get remoteAgentLocked;

  /// No description provided for @remoteAgentLogin.
  ///
  /// In en, this message translates to:
  /// **'Sign in'**
  String get remoteAgentLogin;

  /// No description provided for @remoteAgentPrompt.
  ///
  /// In en, this message translates to:
  /// **'System authorization'**
  String get remoteAgentPrompt;

  /// No description provided for @remoteAgentTransition.
  ///
  /// In en, this message translates to:
  /// **'Changing context'**
  String get remoteAgentTransition;

  /// No description provided for @remoteAgentUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Context unavailable'**
  String get remoteAgentUnavailable;

  /// No description provided for @remoteAgentImageMissing.
  ///
  /// In en, this message translates to:
  /// **'There is no current image. The previous image is hidden.'**
  String get remoteAgentImageMissing;

  /// No description provided for @remoteAgentImageWaiting.
  ///
  /// In en, this message translates to:
  /// **'Waiting for a new frame from the current context.'**
  String get remoteAgentImageWaiting;

  /// No description provided for @remoteAgentInputUnavailable.
  ///
  /// In en, this message translates to:
  /// **'The host does not support input in this context. Sensitive features are suspended.'**
  String get remoteAgentInputUnavailable;

  /// No description provided for @remoteAgentReconnectContent.
  ///
  /// In en, this message translates to:
  /// **'Files, clipboard and sound remain suspended until you reconnect.'**
  String get remoteAgentReconnectContent;

  /// No description provided for @remoteAgentSensitiveSuspended.
  ///
  /// In en, this message translates to:
  /// **'Protected context: clipboard, files and sound are suspended.'**
  String get remoteAgentSensitiveSuspended;
}

class _AppLocalizationsDelegate
    extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  Future<AppLocalizations> load(Locale locale) {
    return SynchronousFuture<AppLocalizations>(lookupAppLocalizations(locale));
  }

  @override
  bool isSupported(Locale locale) =>
      <String>['en', 'es'].contains(locale.languageCode);

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}

AppLocalizations lookupAppLocalizations(Locale locale) {
  // Lookup logic when only language code is specified.
  switch (locale.languageCode) {
    case 'en':
      return AppLocalizationsEn();
    case 'es':
      return AppLocalizationsEs();
  }

  throw FlutterError(
    'AppLocalizations.delegate failed to load unsupported locale "$locale". This is likely '
    'an issue with the localizations generation tool. Please file an issue '
    'on GitHub with a reproducible sample app and the gen-l10n configuration '
    'that was used.',
  );
}
