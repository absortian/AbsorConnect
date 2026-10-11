<?php

namespace App\Connections;

use Symfony\Component\DependencyInjection\Attribute\Autowire;

/**
 * Cifrado en reposo de los secretos de las conexiones con sodium secretbox
 * (XSalsa20-Poly1305). Formato: "v1:" + base64(nonce ‖ ciphertext) del JSON
 * de los secretos.
 *
 * La clave es CONNECTIONS_KEY, distinta de APP_SECRET: rotar APP_SECRET no
 * debe dejar ilegibles las credenciales de nadie. Para rotar CONNECTIONS_KEY,
 * la anterior pasa a CONNECTIONS_KEY_PREVIOUS: lo cifrado con ella se sigue
 * leyendo y se vuelve a cifrar con la actual en el siguiente guardado.
 */
final class ConnectionsCrypto
{
    private const string PREFIX = 'v1:';

    private readonly string $key;
    private readonly ?string $previousKey;

    public function __construct(
        #[\SensitiveParameter] #[Autowire(env: 'CONNECTIONS_KEY')] string $key,
        #[\SensitiveParameter] #[Autowire(env: 'default::CONNECTIONS_KEY_PREVIOUS')] ?string $previousKey = null,
    ) {
        $this->key = self::decodeKey($key, 'CONNECTIONS_KEY');
        $this->previousKey = null === $previousKey || '' === $previousKey ? null : self::decodeKey($previousKey, 'CONNECTIONS_KEY_PREVIOUS');
    }

    /** @param array<string, string> $secrets */
    public function encrypt(#[\SensitiveParameter] array $secrets): string
    {
        $nonce = random_bytes(SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
        $ciphertext = sodium_crypto_secretbox(json_encode($secrets, JSON_THROW_ON_ERROR), $nonce, $this->key);

        return self::PREFIX.base64_encode($nonce.$ciphertext);
    }

    /** null si no se puede descifrar con ninguna de las claves (o el valor está dañado). */
    public function decrypt(string $payload): ?DecryptedSecrets
    {
        if (!str_starts_with($payload, self::PREFIX)) {
            return null;
        }
        $raw = base64_decode(substr($payload, \strlen(self::PREFIX)), true);
        if (false === $raw || \strlen($raw) < SODIUM_CRYPTO_SECRETBOX_NONCEBYTES + SODIUM_CRYPTO_SECRETBOX_MACBYTES) {
            return null;
        }
        $nonce = substr($raw, 0, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
        $ciphertext = substr($raw, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);

        foreach ([[$this->key, false], [$this->previousKey, true]] as [$key, $isPrevious]) {
            if (null === $key) {
                continue;
            }
            $plain = sodium_crypto_secretbox_open($ciphertext, $nonce, $key);
            if (false === $plain) {
                continue;
            }
            $secrets = json_decode($plain, true);
            if (!\is_array($secrets)) {
                return null;
            }

            return new DecryptedSecrets(array_filter($secrets, 'is_string'), $isPrevious);
        }

        return null;
    }

    private static function decodeKey(#[\SensitiveParameter] string $encoded, string $name): string
    {
        $key = base64_decode($encoded, true);
        if (false === $key || SODIUM_CRYPTO_SECRETBOX_KEYBYTES !== \strlen($key)) {
            throw new \InvalidArgumentException(\sprintf('%s must be %d random bytes encoded in base64.', $name, SODIUM_CRYPTO_SECRETBOX_KEYBYTES));
        }

        return $key;
    }
}
