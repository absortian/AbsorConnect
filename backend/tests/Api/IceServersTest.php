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
        self::assertSame([['urls' => ['stun:stun.ejemplo.com:3478']]], $body['iceServers']);
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
        // Caducidad redondeada a la hora: entre 23 y 24 h desde ahora
        self::assertGreaterThan(time() + 23 * 3600 - 5, (int) $expiry);
        self::assertLessThanOrEqual(time() + 86400, (int) $expiry);
        self::assertSame(IceServers::credential('secreto-del-rele', $turn['username']), $turn['credential']);

        // La misma cuenta recibe el mismo usuario durante la hora (la cuota del relé cuenta por usuario)
        $again = $this->getJson('/api/remote/ice-servers', self::auth($registered['token']))['iceServers'][1];
        if (intdiv(time(), 3600) === intdiv((int) $expiry - 86400, 3600)) {
            self::assertSame($turn['username'], $again['username']);
        }
    }

    public function testCredentialRequestsAreLimitedPerAccount(): void
    {
        $this->setEnv(['TURN_URLS' => 'turn:turn.ejemplo.com:3478', 'TURN_SECRET' => 'secreto-del-rele']);
        $token = $this->register()['token'];
        for ($i = 0; $i < 120; ++$i) {
            $this->getJson('/api/remote/ice-servers', self::auth($token));
            self::assertResponseIsSuccessful();
        }

        $body = $this->getJson('/api/remote/ice-servers', self::auth($token));

        self::assertResponseStatusCodeSame(429);
        self::assertSame('too_many_requests', $body['error']['code']);
        self::assertGreaterThan(0, $body['error']['details']['retryAfter']);
        // Otra cuenta no se ve afectada
        $this->getJson('/api/remote/ice-servers', self::auth($this->register('beto@ejemplo.com')['token']));
        self::assertResponseIsSuccessful();
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
