<?php

namespace App\Tests\Unit;

use App\Connections\ConnectionsCrypto;
use PHPUnit\Framework\TestCase;

final class ConnectionsCryptoTest extends TestCase
{
    private const array SECRETS = ['accessKeyId' => 'AKIA-EJEMPLO', 'secretAccessKey' => 'clave/secreta+con=símbolos'];

    public function testRoundTrip(): void
    {
        $crypto = new ConnectionsCrypto(self::key());

        $payload = $crypto->encrypt(self::SECRETS);
        $decrypted = $crypto->decrypt($payload);

        self::assertStringStartsWith('v1:', $payload);
        self::assertStringNotContainsString('AKIA', base64_decode(substr($payload, 3)));
        self::assertSame(self::SECRETS, $decrypted?->secrets);
        self::assertFalse($decrypted->needsReencryption);
    }

    public function testEachEncryptionUsesAFreshNonce(): void
    {
        $crypto = new ConnectionsCrypto(self::key());

        self::assertNotSame($crypto->encrypt(self::SECRETS), $crypto->encrypt(self::SECRETS));
    }

    public function testRotationReadsWithThePreviousKeyAndAsksToReencrypt(): void
    {
        $old = self::key();
        $new = self::key();
        $payload = (new ConnectionsCrypto($old))->encrypt(self::SECRETS);
        $rotated = new ConnectionsCrypto($new, $old);

        $decrypted = $rotated->decrypt($payload);
        self::assertSame(self::SECRETS, $decrypted?->secrets);
        self::assertTrue($decrypted->needsReencryption);

        // Lo que se vuelve a cifrar ya se lee solo con la clave nueva
        $reencrypted = $rotated->encrypt($decrypted->secrets);
        $onlyNew = (new ConnectionsCrypto($new))->decrypt($reencrypted);
        self::assertSame(self::SECRETS, $onlyNew?->secrets);
        self::assertFalse($onlyNew->needsReencryption);
    }

    public function testEmptyPreviousKeyIsIgnored(): void
    {
        $crypto = new ConnectionsCrypto(self::key(), '');

        self::assertSame(self::SECRETS, $crypto->decrypt($crypto->encrypt(self::SECRETS))?->secrets);
    }

    public function testDecryptionFailures(): void
    {
        $crypto = new ConnectionsCrypto(self::key());
        $payload = (new ConnectionsCrypto(self::key()))->encrypt(self::SECRETS);
        $own = $crypto->encrypt(self::SECRETS);
        $tampered = substr($own, 0, -2).('A' === $own[-2] ? 'B' : 'A').$own[-1];

        self::assertNull($crypto->decrypt($payload), 'otra clave');
        self::assertNull($crypto->decrypt($tampered), 'alterado');
        self::assertNull($crypto->decrypt('v1:no-es-base64!'), 'basura');
        self::assertNull($crypto->decrypt('v1:'.base64_encode('corto')), 'demasiado corto');
        self::assertNull($crypto->decrypt('v2:'.substr($own, 3)), 'versión desconocida');
    }

    public function testInvalidKeysAreRejected(): void
    {
        foreach (['', 'no-es-base64!', base64_encode(random_bytes(16))] as $key) {
            try {
                new ConnectionsCrypto($key);
                self::fail('Se esperaba una excepción');
            } catch (\InvalidArgumentException $e) {
                self::assertStringContainsString('CONNECTIONS_KEY', $e->getMessage());
                if ('' !== $key) {
                    self::assertStringNotContainsString($key, $e->getMessage());
                }
            }
        }
    }

    private static function key(): string
    {
        return base64_encode(random_bytes(32));
    }
}
