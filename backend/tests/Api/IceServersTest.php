<?php

namespace App\Tests\Api;

use App\Remote\IceServers;
use App\Tests\ApiTestCase;

/** Escenarios de "Credenciales del relé" (remote-signaling). */
final class IceServersTest extends ApiTestCase
{
    /** @var array<string, string|null> */
    private array $savedEnv = [];

    protected function tearDown(): void
    {
        foreach ($this->savedEnv as $name => $value) {
            $_ENV[$name] = $_SERVER[$name] = $value;
        }
        parent::tearDown();
    }

    public function testWithoutTurnOnlyStunIsOffered(): void
    {
        $this->setEnv(['STUN_URLS' => 'stun:stun.ejemplo.com:3478', 'TURN_URLS' => 'turn:turn.ejemplo.com:3478', 'TURN_SECRET' => '']);
        $token = $this->register()['token'];

        $body = $this->getJson('/api/remote/ice-servers', self::auth($token));

        self::assertResponseIsSuccessful();
        self::assertSame(['iceServers' => [['urls' => ['stun:stun.ejemplo.com:3478']]], 'ttl' => 86400], $body);
    }

    public function testTurnCredentialsExpireIn24Hours(): void
    {
        $this->setEnv([
            'STUN_URLS' => 'stun:turn.ejemplo.com:3478',
            'TURN_URLS' => 'turn:turn.ejemplo.com:3478?transport=udp, turns:turn.ejemplo.com:5349?transport=tcp',
            'TURN_SECRET' => 'secreto-del-rele',
        ]);
        $registered = $this->register();

        $turn = $this->getJson('/api/remote/ice-servers', self::auth($registered['token']))['iceServers'][1];

        self::assertSame(['turn:turn.ejemplo.com:3478?transport=udp', 'turns:turn.ejemplo.com:5349?transport=tcp'], $turn['urls']);
        [$expiry, $userId] = explode(':', $turn['username'], 2);
        self::assertSame($registered['user']['id'], $userId);
        self::assertEqualsWithDelta(time() + 86400, (int) $expiry, 5);
        self::assertSame(IceServers::credential('secreto-del-rele', $turn['username']), $turn['credential']);
    }

    public function testRequiresAnAccount(): void
    {
        $this->getJson('/api/remote/ice-servers');

        self::assertResponseStatusCodeSame(401);
    }

    /** @param array<string, string> $values */
    private function setEnv(array $values): void
    {
        foreach ($values as $name => $value) {
            $this->savedEnv[$name] ??= $_ENV[$name] ?? null;
            $_ENV[$name] = $_SERVER[$name] = $value;
        }
    }
}
