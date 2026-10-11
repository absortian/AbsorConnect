<?php

namespace App\Connections;

final readonly class DecryptedSecrets
{
    /** @param array<string, string> $secrets */
    public function __construct(
        public array $secrets,
        /** Se descifró con CONNECTIONS_KEY_PREVIOUS: hay que volver a cifrar con la actual. */
        public bool $needsReencryption,
    ) {
    }
}
