# Extensión de administración del canal control, revisión 1

Contrato de la tarea 8.2 de `add-unattended-admin-access`, compartido por
`agentProtocol.ts` y `mobile/lib/src/remote/agent_protocol.dart`. Los vectores
`agent-protocol-vectors.json` se ejecutan en ambos lenguajes. Son analizadores
preparados para la integración: todavía no conectan un servicio, habilitan
operaciones ni certifican un equipo. Los analizadores del modo de usuario siguen
ignorando estos mensajes. No cambia la autenticación v1 ni `auth-vectors.json`.

## Negociación obligatoria antes de integrar

1. Completar la autenticación v1, con nonce nuevo y huellas DTLS de esa conexión.
2. El host nativo anuncia `features.unattendedControl: true`, únicamente si
   implementa esta revisión. Ausencia, `false` o una versión desconocida no dan acceso.
3. El controlador que implemente la extensión responde `agent-control-enable`.
4. Solo después de ambos pasos el host envía capacidades/contexto y atiende las
   operaciones anunciadas. Un mensaje analizable por sí solo nunca autoriza nada.

El anuncio es opcional. Los hosts y controladores actuales no negocian la
extensión ni ejecutan sus operaciones. Esta integración y sus pruebas de estado
pertenecen a 3.3, 7–10; no se dan por hechas al completar los analizadores de 8.2.

## Forma y límites

Cada mensaje es un objeto JSON UTF-8 de **hasta 2048 bytes**, con `v: 1`,
`extension: 1` y `type`. Se rechazan campos ausentes o adicionales, arrays como
objeto raíz, JSON roto, versiones desconocidas y valores fuera de los enums.
Las claves de la tabla son adicionales al sobre; no hay argumentos opcionales,
rutas, programas, texto de shell ni texto de error libre.

| Dirección | type | Campos |
|---|---|---|
| Controlador → host | `agent-control-enable` | Ninguno |
| Host → controlador | `agent-capabilities` | `agentVersion`, `capabilities`, `actions` |
| Host → controlador | `agent-context` | `sequence`, `state`, `imageAvailable` |
| Controlador → host | `host-operation` | `id`, `action` |
| Host → controlador | `host-operation-result` | `id`, `action`, `status`; `code` obligatorio solo con error |

`agentVersion`: entre 1 y 32 caracteres ASCII `[0-9A-Za-z.+-]`, sin espacios ni
saltos de línea. `capabilities` contiene exactamente cuatro booleanos:
`administration`, `login`, `secureAttention`, `restart`, los mismos nombres del
backend. Son declaraciones del host; no sustituyen las pruebas que certifican
esa combinación de sistema, versión y arquitectura.

`actions` es una lista de 0–4 valores únicos: `lock`, `logout`, `restart`,
`secure_attention`. Para anunciar `restart`/`secure_attention`, su capacidad
correspondiente debe ser verdadera. La lista expresa lo permitido en la sesión;
no recibir una acción significa que está prohibida. No se infiere un permiso a
partir del sistema operativo ni de un resultado anterior.

`state`: `user_desktop`, `locked`, `login`, `secure_prompt`, `transition`,
`unavailable`. `sequence` es un entero entre 1 y 2147483647. `imageAvailable`
es booleano y debe ser falso en `transition`/`unavailable`. Al integrar, la
secuencia aumenta por conexión y se ignoran estados viejos; el visor retira la
imagen anterior cuando no haya imagen actual. Solo `user_desktop` puede permitir
audio, ficheros y portapapeles. Antes de entrar en otro contexto, el host libera
entrada pendiente y suspende esas funciones, sin delegarlo al controlador.

`id`: UUID v4 canónico en minúsculas, 36 caracteres. `action` usa el mismo enum
que `actions`, sin parámetros. El agente debe comprobar autenticación,
autorización vigente, negociación y capacidad actual al ejecutar. Debe deduplicar
por conexión/ID y recordar también la acción: repetir el ID no ejecuta otra vez
la operación y cambiar de acción con el mismo ID se rechaza. Esto requiere el
registro y ejecución de 3.3; los analizadores carecen de efectos y no lo implementan.

`status`: `accepted`, `rejected`, `failed`. `accepted` no admite `code` y solo
confirma que el sistema aceptó la solicitud, sin probar que ya reinició o cerró
sesión. Los otros dos exigen uno de: `not_supported`, `not_allowed`, `busy`,
`cancelled`, `system_error`, `session_expired`. Un resultado solo se aplica a
un ID/acción pendiente de esa conexión; jamás inicia una espera de reinicio si
fue rechazado. Reiniciar o cambiar de usuario termina la autorización y exige
autenticación nueva. No se conserva una orden para ejecutarla al reconectar.

Las credenciales del sistema solo son entrada hacia su pantalla, nunca campos de
estos mensajes, parámetros de operaciones ni datos para la API. El agente aún
debe validar sus mensajes en origen y hacer cumplir el límite de revocación de
30 segundos con reloj monotónico.
