// ABI exclusiva del diagnóstico, solo al compilar la característica lab-http.
#pragma once
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif
// Buffers válidos durante la llamada, sin modificación concurrente. No se retienen.
// Crear consume configuración privada loopback y usa K pública fija, nunca la del PC.
uint64_t absor_bridge_create(const uint8_t* config, size_t length);
// Estado: 0 espera API, 1 permiso API, 2 autenticado; -1 caducado, -2 revocado, -3 error/parado.
int32_t absor_bridge_poll(uint64_t id);
// Oferta/ICE de API, una sola vez. 0 pendiente, longitud positiva, negativo error.
// out exclusivo de capacidad 262144; nunca contiene credencial de agente/cuenta.
int32_t absor_bridge_offer(uint64_t id, uint8_t* out, size_t capacity);
// Publicar la respuesta de ESA oferta por API; no renueva la autorización.
int32_t absor_bridge_answer(uint64_t id, const uint8_t* answer, size_t length);
// Huellas de las descripciones realmente aplicadas de ESA PeerConnection.
// out es exclusivo; capacidad 1024..4096. Longitud positiva, 0 si espera
// confirmación de respuesta API o error negativo. No se reutiliza un reto.
int32_t absor_bridge_hello(uint64_t id, const uint8_t* offer, size_t offer_length,
    const uint8_t* answer, size_t answer_length, uint8_t* out, size_t capacity);
// Una prueba: 1 aceptada y autorizada, 0 incorrecta, negativo error/parado.
int32_t absor_bridge_auth(uint64_t id, const uint8_t* proof, size_t length);
// Solo native-fixture: RGB 320x180, capacidad EXACTA 172800. 0 pendiente,
// 172800 frame propio autenticado/autorizado, negativo denegado o fallo terminal.
int32_t absor_bridge_native_frame(uint64_t id, uint8_t* out, size_t capacity);
// Subconjunto fijo del canal input v1, máximo 128 bytes. No acepta texto,
// teclas arbitrarias o otra ventana. Solo un clic/KeyA completos por sesión.
int32_t absor_bridge_native_input(uint64_t id, const uint8_t* input, size_t length);
// Diagnóstico sin píxeles/credenciales; capacidad EXACTA 1024, longitud o error.
int32_t absor_bridge_native_status(uint64_t id, uint8_t* out, size_t capacity);
// Cierre idempotente por identificador; no se reutilizan identificadores.
void absor_bridge_close(uint64_t id);
#ifdef __cplusplus
}
#endif
