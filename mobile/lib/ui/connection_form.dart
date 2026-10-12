import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../src/connections.dart';
import '../src/s3.dart';
import '../src/services.dart';
import 'errors.dart';
import 'key_import.dart';
import 'theme.dart';

/// Alta y edición de conexiones (mismos campos que el formulario del escritorio).
class ConnectionForm extends StatefulWidget {
  const ConnectionForm({super.key, this.editing});

  final Entry? editing;

  @override
  State<ConnectionForm> createState() => _ConnectionFormState();
}

class _ConnectionFormState extends State<ConnectionForm> {
  final _form = GlobalKey<FormState>();
  late String _type = widget.editing?.isSsh == true ? 'ssh' : 's3';
  late String? _parentId = widget.editing?.parentId;
  late final _name = TextEditingController(text: widget.editing?.name);
  // S3
  late final _endpoint = TextEditingController(text: widget.editing?.str('endpoint'));
  late final _region = TextEditingController(text: widget.editing?.isS3 == true ? widget.editing!.str('region') : 'us-east-1');
  late final _accessKey = TextEditingController(text: widget.editing?.str('accessKeyId'));
  late final _secretKey = TextEditingController(text: widget.editing?.str('secretAccessKey'));
  late final _bucket = TextEditingController(text: widget.editing?.str('bucket'));
  // SSH
  late final _host = TextEditingController(text: widget.editing?.str('host'));
  late final _port = TextEditingController(text: '${widget.editing?.data['port'] ?? 22}');
  late final _username = TextEditingController(text: widget.editing?.str('username'));
  late String _authMethod = widget.editing?.str('authMethod') == 'privateKey' ? 'privateKey' : 'password';
  late final _password = TextEditingController(text: widget.editing?.str('password'));
  late final _passphrase = TextEditingController(text: widget.editing?.str('passphrase'));
  late final _initialPath = TextEditingController(text: widget.editing?.str('initialPath'));
  late String _keyName = widget.editing?.str('privateKeyPath') ?? '';
  PickedKey? _pickedKey;
  bool _hasLocalKey = false;
  bool _saving = false;
  String? _error;

  bool get _unavailable => widget.editing?.credentialsUnavailable == true;

  @override
  void initState() {
    super.initState();
    final editing = widget.editing;
    if (editing != null && editing.isSsh) {
      WidgetsBinding.instance.addPostFrameCallback((_) async {
        final pem = await AppServices.of(context).keys.read(editing.id);
        if (mounted) setState(() => _hasLocalKey = pem != null);
      });
    }
  }

  @override
  void dispose() {
    for (final c in [_name, _endpoint, _region, _accessKey, _secretKey, _bucket, _host, _port, _username, _password, _passphrase, _initialPath]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _importKey() async {
    final t = AppLocalizations.of(context);
    try {
      final picked = await pickPrivateKey(_passphrase.text);
      if (picked == null) return;
      setState(() {
        _pickedKey = picked;
        _keyName = picked.fileName;
        _error = null;
      });
    } on FormatException {
      setState(() => _error = t.keyInvalid);
    }
  }

  Future<void> _save() async {
    final t = AppLocalizations.of(context);
    if (!_form.currentState!.validate()) return;
    if (_type == 'ssh' && _authMethod == 'privateKey' && _keyName.isEmpty) {
      setState(() => _error = t.err_ssh_key_missing);
      return;
    }
    final services = AppServices.of(context);
    final id = widget.editing?.id ?? _newId();
    // Igual que el escritorio: credenciales ilegibles que no se reintroducen se conservan
    final secretsEmpty = _type == 's3' ? _accessKey.text.isEmpty && _secretKey.text.isEmpty : _password.text.isEmpty && _passphrase.text.isEmpty;
    final keepUnavailable = _unavailable && secretsEmpty;
    final base = <String, dynamic>{
      // Conserva los campos que esta app no conoce
      if (widget.editing != null && widget.editing!.data['type'] == _type) ...widget.editing!.data,
      'id': id,
      'name': _name.text.trim(),
      'parentId': _parentId,
    }..remove('credentialsUnavailable');
    final Map<String, dynamic> data;
    if (_type == 's3') {
      data = {
        ...base,
        'type': 's3',
        'endpoint': S3Client.normalizeEndpoint(_endpoint.text),
        'region': _region.text.trim(),
        'accessKeyId': _accessKey.text.trim(),
        'secretAccessKey': _secretKey.text.trim(),
        'bucket': _bucket.text.trim(),
      };
    } else {
      data = {
        ...base,
        'type': 'ssh',
        'host': _host.text.trim(),
        'port': int.parse(_port.text.trim()),
        'username': _username.text.trim(),
        'authMethod': _authMethod,
        if (_authMethod == 'password') 'password': _password.text else ...{'privateKeyPath': _keyName, 'passphrase': _passphrase.text},
        'initialPath': _initialPath.text.trim(),
      };
      if (_authMethod == 'password') {
        data.remove('privateKeyPath');
        data.remove('passphrase');
      } else {
        data.remove('password');
      }
    }
    if (keepUnavailable) data['credentialsUnavailable'] = true;

    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      // La clave importada se guarda solo en este dispositivo, nunca en la cuenta
      final picked = _pickedKey;
      if (picked != null) await services.keys.write(id, picked.pem);
      await services.connections.upsert(Entry(data));
      if (mounted) Navigator.of(context).pop(true);
    } on ConnectionsConflict {
      if (mounted) setState(() => _error = t.connectionsConflict);
    } on Object catch (error) {
      if (mounted) setState(() => _error = t.saveFailed(errorText(context, error)));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  /// UUID v4 aleatorio, como `crypto.randomUUID()` en el escritorio.
  static String _newId() => newUuid();

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final folders = AppServices.of(context).connections.folders;
    String? required(String? value) => (value == null || value.trim().isEmpty) ? t.required : null;
    final secretRequired = _unavailable ? null : required;

    return Scaffold(
      appBar: AppBar(title: Text(widget.editing == null ? t.addConnection : t.editConnection)),
      body: Form(
        key: _form,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (_error != null) _Banner(text: _error!, color: AppColors.danger),
            if (_unavailable) _Banner(text: '${t.credentialsUnavailable} ${t.keepUnavailable}', color: AppColors.warning),
            SegmentedButton<String>(
              segments: [ButtonSegment(value: 's3', label: Text(t.typeS3)), ButtonSegment(value: 'ssh', label: Text(t.typeSsh))],
              selected: {_type},
              showSelectedIcon: false,
              onSelectionChanged: widget.editing == null ? (value) => setState(() => _type = value.first) : null,
            ),
            const SizedBox(height: 16),
            TextFormField(key: const Key('form-name'), controller: _name, decoration: InputDecoration(labelText: t.connectionName), validator: required),
            const SizedBox(height: 12),
            DropdownButtonFormField<String?>(
              initialValue: folders.any((f) => f.id == _parentId) ? _parentId : null,
              decoration: InputDecoration(labelText: t.folder),
              items: [
                DropdownMenuItem<String?>(value: null, child: Text(t.folderNone)),
                for (final f in folders) DropdownMenuItem<String?>(value: f.id, child: Text(f.name)),
              ],
              onChanged: (value) => _parentId = value,
            ),
            const SizedBox(height: 12),
            if (_type == 's3') ...[
              TextFormField(
                key: const Key('form-endpoint'),
                controller: _endpoint,
                keyboardType: TextInputType.url,
                autocorrect: false,
                enableSuggestions: false,
                decoration: InputDecoration(labelText: t.endpoint, hintText: 'https://…'),
                validator: (v) => required(v) ?? (S3Client.isValidEndpoint(v!) ? null : t.err_s3_invalid_endpoint),
              ),
              const SizedBox(height: 12),
              TextFormField(controller: _region, autocorrect: false, decoration: InputDecoration(labelText: t.region, hintText: 'us-east-1')),
              const SizedBox(height: 12),
              TextFormField(key: const Key('form-access-key'), controller: _accessKey, autocorrect: false, enableSuggestions: false, decoration: InputDecoration(labelText: t.accessKeyId), validator: secretRequired),
              const SizedBox(height: 12),
              TextFormField(key: const Key('form-secret-key'), controller: _secretKey, obscureText: true, decoration: InputDecoration(labelText: t.secretAccessKey), validator: secretRequired),
              const SizedBox(height: 12),
              TextFormField(controller: _bucket, autocorrect: false, decoration: InputDecoration(labelText: t.defaultBucket)),
            ] else ...[
              Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Expanded(child: TextFormField(key: const Key('form-host'), controller: _host, keyboardType: TextInputType.url, autocorrect: false, decoration: InputDecoration(labelText: t.host), validator: required)),
                const SizedBox(width: 12),
                SizedBox(
                  width: 96,
                  child: TextFormField(
                    key: const Key('form-port'),
                    controller: _port,
                    keyboardType: TextInputType.number,
                    decoration: InputDecoration(labelText: t.port),
                    validator: (v) {
                      final port = int.tryParse(v?.trim() ?? '');
                      return port == null || port < 1 || port > 65535 ? t.invalidPort : null;
                    },
                  ),
                ),
              ]),
              const SizedBox(height: 12),
              TextFormField(key: const Key('form-username'), controller: _username, autocorrect: false, decoration: InputDecoration(labelText: t.username), validator: required),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                initialValue: _authMethod,
                decoration: InputDecoration(labelText: t.authMethod),
                items: [
                  DropdownMenuItem(value: 'password', child: Text(t.authMethodPassword)),
                  DropdownMenuItem(value: 'privateKey', child: Text(t.authMethodKey)),
                ],
                onChanged: (value) => setState(() => _authMethod = value ?? 'password'),
              ),
              const SizedBox(height: 12),
              if (_authMethod == 'password')
                TextFormField(key: const Key('form-password'), controller: _password, obscureText: true, decoration: InputDecoration(labelText: t.password))
              else ...[
                TextFormField(controller: _passphrase, obscureText: true, decoration: InputDecoration(labelText: t.passphrase)),
                const SizedBox(height: 12),
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(border: Border.all(color: AppColors.border), borderRadius: BorderRadius.circular(10)),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(t.privateKey, style: const TextStyle(fontWeight: FontWeight.w600)),
                    const SizedBox(height: 6),
                    Text(
                      _pickedKey != null || _hasLocalKey ? t.keyImported(_keyName) : (_keyName.isEmpty ? t.keyNotImported : '$_keyName · ${t.keyNotImported}'),
                      style: const TextStyle(color: AppColors.textSecondary),
                    ),
                    const SizedBox(height: 4),
                    Text(t.keyStaysHere, style: const TextStyle(color: AppColors.textMuted, fontSize: 12)),
                    const SizedBox(height: 8),
                    OutlinedButton.icon(onPressed: _importKey, icon: const Icon(Icons.key), label: Text(t.importKey)),
                  ]),
                ),
              ],
              const SizedBox(height: 12),
              TextFormField(controller: _initialPath, autocorrect: false, decoration: InputDecoration(labelText: t.initialPath, hintText: '~/www')),
            ],
            const SizedBox(height: 24),
            FilledButton(
              key: const Key('form-save'),
              onPressed: _saving ? null : _save,
              child: _saving ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)) : Text(t.save),
            ),
          ],
        ),
      ),
    );
  }
}

class _Banner extends StatelessWidget {
  const _Banner({required this.text, required this.color});

  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
        margin: const EdgeInsets.only(bottom: 16),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.1),
          border: Border.all(color: color.withValues(alpha: 0.3)),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Text(text, style: const TextStyle(fontSize: 13)),
      );
}
