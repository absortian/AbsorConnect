# Tasks

## 1. Main

- [x] 1.1 En `store.ts`, lectura por campo (D1–D2): `isEncryptedBlob`, descifrado con `try/catch` por secreto, marca `credentialsUnavailable` y secretos en claro heredados aunque digan `_encrypted`. Verificar: con el arnés, una conexión cifrada con una clave que ya no existe aparece marcada junto al resto, y una con `_encrypted: true` y secretos en claro carga con sus credenciales.
- [x] 1.2 En `store.ts`, guardado (D2, D3, D5): conservar los secretos ilegibles que llegan vacíos, `_encrypted` solo si todo quedó cifrado, y escritura atómica con `.bak`. Verificar: guardar otros cambios deja intacto el blob ilegible en disco, y existen `.bak` y ningún `.tmp` tras guardar.
- [x] 1.3 Fichero dañado y errores de lectura (D4), y el estado del almacén con el canal `get-store-status` en `index.ts` (D6). Verificar: un `connections.json` con JSON inválido se aparta a `.corrupt-<fecha>` y `get-store-status` devuelve su ruta.

## 2. Shared y preload

- [x] 2.1 Añadir `credentialsUnavailable?: boolean` a las conexiones en `src/shared/types.ts`, y `getStoreStatus` al preload y a `index.d.ts`. Verificar: `npm run typecheck` pasa.

## 3. Renderer

- [x] 3.1 `ConnectionsSidebar.tsx`: aviso en la barra lateral (credenciales ilegibles o fichero apartado) e icono en las conexiones marcadas. Verificar: con el arnés se ven el aviso y el icono con su texto.
- [x] 3.2 Formulario de edición de una conexión marcada: aviso de volver a introducir credenciales, campos secretos no obligatorios y conservación de la marca si se dejan vacíos (D2). Verificar: renombrar la conexión sin tocar los secretos conserva el blob, e introducir credenciales nuevas quita la marca.
- [x] 3.3 `SettingsPanel.tsx`: nota cuando el sistema no permite cifrar. Textos de 3.1–3.3 en `locales/en.json` y `es.json`. Verificar: sin claves i18n sin traducir.

## 4. Verificación

- [x] 4.1 `npm run typecheck` pasa y los ficheros tocados no añaden errores de lint.
- [x] 4.2 (macOS, arnés) Escenarios de la spec: clave perdida (borrando la entrada de Llavero de la app de pruebas), guardar otros cambios, volver a introducir credenciales, JSON corrupto y secreto en claro marcado como cifrado (que se cifra al guardar).
- [x] 4.3 (Linux sin keyring, VM de OrbStack) Guardar una conexión deja los secretos sin la marca `_encrypted`, y Ajustes muestra la nota de cifrado no disponible.

## Workflow follow-up

- Archivar el change (`/opsx:archive`) tras la verificación para actualizar `connection-management` en `openspec/specs/`.
