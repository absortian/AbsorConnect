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
// Huellas de las descripciones realmente aplicadas de ESA PeerConnection.
// out es exclusivo; capacidad 1024..4096. Devuelve longitud positiva o error negativo.
int32_t absor_bridge_hello(uint64_t id, const uint8_t* offer, size_t offer_length,
    const uint8_t* answer, size_t answer_length, uint8_t* out, size_t capacity);
// Una prueba: 1 aceptada y autorizada, 0 incorrecta, negativo error/parado.
int32_t absor_bridge_auth(uint64_t id, const uint8_t* proof, size_t length);
// Cierre idempotente por identificador; no se reutilizan identificadores.
void absor_bridge_close(uint64_t id);
#ifdef __cplusplus
}
#endif
