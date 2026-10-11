# Proposal

## Why

El almacén de conexiones puede perder datos sin avisar al usuario. Si `connections.json` no se puede leer o alguna credencial no se puede descifrar, `getConnections()` devuelve una lista vacía y el siguiente guardado (añadir, mover o editar cualquier conexión) sobrescribe el fichero: el usuario pierde **todas** sus conexiones. Ocurre, por ejemplo, si la clave de cifrado del sistema cambia o se pierde, si el fichero se corrompe, o en Linux cuando aparece un keyring después de haber guardado secretos sin cifrar, porque hoy se marcan como cifrados aunque no lo estén. Se detectó al verificar `rename-to-absor-connect`.

## What Changes

- **Lectura tolerante por credencial:** si un secreto no se puede descifrar, la conexión se muestra igualmente con el resto de sus datos y marcada como "credenciales no disponibles". El valor cifrado se **conserva** en disco hasta que el usuario introduzca credenciales nuevas.
- **Guardado que no destruye lo ilegible:** guardar la lista nunca reemplaza un secreto ilegible por un valor vacío. Al editar una conexión así, se puede cambiar el resto de datos sin perder el secreto original.
- **Fichero dañado:** si `connections.json` no es JSON válido, se aparta a una copia (`connections.json.corrupt-<fecha>`) y se avisa al usuario, en lugar de sobrescribirlo.
- **Escritura atómica** (fichero temporal y renombrado) y copia del contenido anterior (`connections.json.bak`) en cada guardado.
- **Marca de cifrado veraz:** `_encrypted` solo se escribe cuando los secretos están realmente cifrados. Los secretos guardados en claro por versiones anteriores (aunque estén marcados como cifrados) se leen correctamente y se cifran en el siguiente guardado si el sistema ya tiene almacén seguro.
- **Avisos al usuario:** aviso en la barra lateral cuando hay credenciales ilegibles o se apartó un fichero dañado, icono en cada conexión afectada, y nota en Ajustes cuando el sistema no permite cifrar.

## Fuera de alcance

- Recuperar los secretos ilegibles (no es posible sin la clave original). Solo se conservan y se pide al usuario que los vuelva a introducir.
- Cambiar el mecanismo de cifrado (`safeStorage`) o la ubicación de los datos.
- Cifrar el fichero de exportación.
- Historial de versiones de `connections.json` más allá de una copia `.bak`.

## Impacto en usuarios existentes

- **Datos:** ninguno negativo; el formato del fichero no cambia (salvo que `_encrypted` deja de escribirse cuando no hay cifrado). Aparecen dos ficheros auxiliares junto a `connections.json`: `.bak` y, solo si hubo corrupción, `.corrupt-<fecha>`.
- **Credenciales:** las que hoy se leen siguen leyéndose igual. Las que hoy hacen desaparecer la lista pasan a mostrarse con su conexión y un aviso.
- **Auto-update:** ninguno.

## Capabilities

### New Capabilities
(ninguna)

### Modified Capabilities
- `connection-management`: la protección de secretos pasa a contemplar sistemas sin almacén seguro, y se añaden requisitos para conservar credenciales ilegibles, tratar un fichero de conexiones dañado y leer secretos guardados en claro por versiones anteriores.

## Impact

- **Main:** `src/main/store.ts` (lectura y guardado), `src/main/index.ts` (canal `get-store-status`).
- **Shared:** `src/shared/types.ts` (marca de tiempo de ejecución `credentialsUnavailable`).
- **Preload:** `getStoreStatus`.
- **Renderer:** `ConnectionsSidebar.tsx` (aviso, icono y edición que conserva secretos), `SettingsPanel.tsx` (nota de cifrado no disponible) y locales en/es.
- Sin dependencias nuevas.
