import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:package_info_plus/package_info_plus.dart';

class AvailableUpdate {
  AvailableUpdate(this.version, this.apkUrl, this.pageUrl);

  final String version;
  final String apkUrl;
  final String pageUrl;
}

/// En Android, la app se instala desde la web y se actualiza instalando el APK nuevo
/// encima. Al arrancar se consulta la última release de GitHub; si falla, no se avisa.
class UpdateChecker {
  static const _latest = 'https://api.github.com/repos/absortian/AbsorConnect/releases/latest';

  static Future<AvailableUpdate?> check() async {
    if (!Platform.isAndroid) return null;
    try {
      final current = (await PackageInfo.fromPlatform()).version;
      final response = await http.get(Uri.parse(_latest), headers: {'Accept': 'application/vnd.github+json'}).timeout(const Duration(seconds: 10));
      if (response.statusCode != 200) return null;
      final release = jsonDecode(response.body) as Map<String, dynamic>;
      final version = (release['tag_name'] as String).replaceFirst(RegExp('^v'), '');
      if (!isNewer(version, current)) return null;
      for (final asset in release['assets'] as List) {
        final name = (asset as Map<String, dynamic>)['name'] as String;
        if (name.endsWith('.apk')) {
          return AvailableUpdate(version, asset['browser_download_url'] as String, release['html_url'] as String);
        }
      }
    } on Object {
      // sin red o respuesta inesperada: no se avisa
    }
    return null;
  }

  /// Compara versiones x.y.z numéricamente.
  static bool isNewer(String candidate, String current) {
    List<int> parts(String v) => v.split(RegExp(r'[.+-]')).take(3).map((p) => int.tryParse(p) ?? 0).toList();
    final a = parts(candidate);
    final b = parts(current);
    for (var i = 0; i < 3; i++) {
      final x = i < a.length ? a[i] : 0;
      final y = i < b.length ? b[i] : 0;
      if (x != y) return x > y;
    }
    return false;
  }
}
