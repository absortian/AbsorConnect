// Comprueba el contrato criptográfico compartido; no captura ni abre una conexión.
#include <array>
#include <cstdint>
#include <iostream>
#include <string>
#include <vector>

#include "openssl/crypto.h"
#include "openssl/evp.h"
#include "openssl/hmac.h"

#include "vectors.h"

namespace {
std::vector<uint8_t> Decode(const std::string& text) {
  size_t capacity = 0;
  if (!EVP_DecodedLength(&capacity, text.size())) return {};
  std::vector<uint8_t> bytes(capacity);
  size_t size = 0;
  if (!EVP_DecodeBase64(bytes.data(), &size, capacity,
                        reinterpret_cast<const uint8_t*>(text.data()), text.size())) {
    return {};
  }
  bytes.resize(size);
  return bytes;
}

std::string Proof(const std::vector<uint8_t>& key, const std::string& nonce,
                  const std::string& offer, const std::string& answer) {
  if (key.size() != 32) return {};
  const auto message = std::string("absor-remote-auth-v1\n") + nonce + "\n" + offer + "\n" + answer;
  std::array<uint8_t, EVP_MAX_MD_SIZE> digest{};
  unsigned int length = 0;
  if (!HMAC(EVP_sha256(), key.data(), key.size(),
            reinterpret_cast<const uint8_t*>(message.data()), message.size(),
            digest.data(), &length)) return {};
  std::array<uint8_t, 128> encoded{};
  const auto encoded_length = EVP_EncodeBlock(encoded.data(), digest.data(), length);
  return std::string(reinterpret_cast<const char*>(encoded.data()), encoded_length);
}

bool Equal(const std::string& actual, const std::string& expected) {
  return actual.size() == 44 && actual.size() == expected.size() &&
         CRYPTO_memcmp(actual.data(), expected.data(), actual.size()) == 0;
}
}  // namespace

int main() {
  size_t passed = 0;
  for (const auto& vector : kVectors) {
    auto key = Decode(vector.key);
    if (vector.iterations > 0) {
      const auto salt = Decode(vector.salt);
      std::array<uint8_t, 32> derived{};
      if (!PKCS5_PBKDF2_HMAC(vector.password.data(), vector.password.size(),
                            salt.data(), salt.size(), vector.iterations,
                            EVP_sha256(), derived.size(), derived.data()) ||
          key.size() != derived.size() ||
          CRYPTO_memcmp(key.data(), derived.data(), derived.size()) != 0) return 1;
    }
    if (!Equal(Proof(key, vector.nonce, vector.offer, vector.answer), vector.proof)) return 2;
    if (Equal(Proof(key, vector.nonce + "x", vector.offer, vector.answer), vector.proof)) return 3;
    if (Equal(Proof(key, vector.nonce, vector.offer + "x", vector.answer), vector.proof)) return 4;
    if (Equal(Proof(key, vector.nonce, vector.offer, vector.answer + "x"), vector.proof)) return 5;
    key[0] ^= 1;
    if (Equal(Proof(key, vector.nonce, vector.offer, vector.answer), vector.proof)) return 6;
    if (Equal(Proof({}, vector.nonce, vector.offer, vector.answer), vector.proof)) return 7;
    ++passed;
  }
  std::cout << "{\"vectorsPassed\":" << passed
            << ",\"negativeCasesPerVector\":5,\"transportTested\":false}\n";
  return 0;
}
