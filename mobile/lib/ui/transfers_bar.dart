import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';

import '../l10n/app_localizations.dart';
import '../src/services.dart';
import '../src/transfers.dart';
import 'errors.dart';
import 'theme.dart';

/// Barra inferior con las subidas y descargas en curso o recientes.
class TransfersBar extends StatelessWidget {
  const TransfersBar({super.key});

  @override
  Widget build(BuildContext context) {
    final transfers = AppServices.of(context).transfers;
    final t = AppLocalizations.of(context);
    return ListenableBuilder(
      listenable: transfers,
      builder: (context, _) {
        final items = transfers.items;
        if (items.isEmpty) return const SizedBox.shrink();
        return Material(
          color: AppColors.surface,
          child: SafeArea(
            top: false,
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              const Divider(),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 6, 4, 0),
                child: Row(children: [
                  Text(t.transfers, style: const TextStyle(fontWeight: FontWeight.w600)),
                  const Spacer(),
                  TextButton(onPressed: transfers.clearFinished, child: Text(t.clearFinished)),
                ]),
              ),
              ConstrainedBox(
                constraints: const BoxConstraints(maxHeight: 168),
                child: ListView(
                  shrinkWrap: true,
                  padding: const EdgeInsets.only(bottom: 6),
                  children: [for (final item in items) _TransferTile(item)],
                ),
              ),
            ]),
          ),
        );
      },
    );
  }
}

class _TransferTile extends StatelessWidget {
  const _TransferTile(this.transfer);

  final Transfer transfer;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final status = switch (transfer.status) {
      TransferStatus.running => transfer.upload ? t.transferUploading : t.transferDownloading,
      TransferStatus.done => t.transferDone,
      TransferStatus.failed => t.transferFailed(errorText(context, transfer.error)),
    };
    final file = transfer.file;
    return ListTile(
      dense: true,
      leading: Icon(
        transfer.status == TransferStatus.failed
            ? Icons.error_outline
            : transfer.status == TransferStatus.done
                ? Icons.check_circle_outline
                : (transfer.upload ? Icons.upload : Icons.download),
        color: transfer.status == TransferStatus.failed
            ? AppColors.danger
            : transfer.status == TransferStatus.done
                ? AppColors.success
                : AppColors.accentSoft,
      ),
      title: Text(transfer.name, maxLines: 1, overflow: TextOverflow.ellipsis),
      subtitle: transfer.status == TransferStatus.running
          ? Padding(padding: const EdgeInsets.only(top: 6), child: LinearProgressIndicator(value: transfer.fraction))
          : Text(status, maxLines: 2, overflow: TextOverflow.ellipsis),
      trailing: transfer.status == TransferStatus.done && file != null
          ? IconButton(
              tooltip: t.share,
              icon: const Icon(Icons.ios_share),
              onPressed: () => SharePlus.instance.share(ShareParams(files: [XFile(file.path)])),
            )
          : null,
    );
  }
}
