<?php

namespace App\Tests\Api;

use App\Tests\ApiTestCase;
use PHPUnit\Framework\Attributes\DataProvider;
use Symfony\Component\Uid\UuidV7;

/**
 * Escenarios de "Negociación de las sesiones", "Aislamiento entre cuentas", "El contenido no pasa
 * por el servicio" y "Límites de uso" (remote-signaling).
 */
final class RemoteRequestsTest extends ApiTestCase
{
    private const string OFFER = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\na=fingerprint:sha-256 AA:BB\r\n";
    private const string ANSWER = "v=0\r\no=- 3 4 IN IP4 127.0.0.1\r\na=fingerprint:sha-256 CC:DD\r\n";

    public function testControllerGetsTheAnswer(): void
    {
        [$host, $controller] = $this->accountWithTwoDevices();

        $created = $this->requestSession($controller);
        self::assertResponseStatusCodeSame(201);
        self::assertGreaterThan(new \DateTimeImmutable('+50 seconds'), new \DateTimeImmutable($created['expiresAt']));

        $pending = $this->poll($host)['requests'];
        self::assertCount(1, $pending);
        self::assertSame($created['id'], $pending[0]['id']);
        self::assertSame('Oficina', $pending[0]['controllerName']);
        self::assertSame(self::OFFER, $pending[0]['offer']);
        self::assertSame(['status' => 'pending'], $this->getJson("/api/remote-requests/{$created['id']}", self::auth($controller)));

        $this->putJson("/api/remote-requests/{$created['id']}/answer", ['answer' => self::ANSWER], self::deviceAuth($host));
        self::assertResponseStatusCodeSame(204);

        self::assertSame(['status' => 'answered', 'answer' => self::ANSWER], $this->getJson("/api/remote-requests/{$created['id']}", self::auth($controller)));
        $this->resetLimits();
        self::assertSame([], $this->poll($host)['requests']);
    }

    public function testDeviceCanRejectWithAReason(): void
    {
        [$host, $controller] = $this->accountWithTwoDevices();
        $id = $this->requestSession($controller)['id'];

        $this->putJson("/api/remote-requests/$id/answer", ['rejected' => ['reason' => 'locked', 'retryAfter' => 600]], self::deviceAuth($host));
        self::assertResponseStatusCodeSame(204);

        self::assertSame(
            ['status' => 'rejected', 'rejection' => ['reason' => 'locked', 'retryAfter' => 600]],
            $this->getJson("/api/remote-requests/$id", self::auth($controller)),
        );
        // Una solicitud ya respondida no se puede responder otra vez
        $this->putJson("/api/remote-requests/$id/answer", ['answer' => self::ANSWER], self::deviceAuth($host));
        self::assertResponseStatusCodeSame(409);
        self::assertSame('remote_request_answered', $this->errorCode());
    }

    public function testOfflineOrDisabledDeviceRefusesRequests(): void
    {
        [$host, $controller] = $this->accountWithTwoDevices();

        $this->setLastSeen(self::DEVICE_ID, '-40 seconds');
        $this->requestSession($controller);
        self::assertResponseStatusCodeSame(409);
        self::assertSame('device_offline', $this->errorCode());

        $this->putDevice($host, info: ['remote' => ['state' => 'disabled']]);
        $this->requestSession($controller);
        self::assertResponseStatusCodeSame(409);
        self::assertSame('remote_disabled', $this->errorCode());
    }

    public function testExpiredRequestsAreReportedAndDeleted(): void
    {
        [$host, $controller] = $this->accountWithTwoDevices();
        $id = $this->requestSession($controller)['id'];
        $this->db()->executeStatement('UPDATE remote_request SET expires_at = ? WHERE id = ?', [(new \DateTimeImmutable('-1 second'))->format('Y-m-d H:i:s'), $id]);

        $this->getJson("/api/remote-requests/$id", self::auth($controller));
        self::assertResponseStatusCodeSame(410);
        self::assertSame('remote_request_expired', $this->errorCode());

        // La consulta del equipo borra las caducadas: no queda nada de su negociación
        self::assertSame([], $this->poll($host)['requests']);
        self::assertSame(0, (int) $this->db()->fetchOne('SELECT COUNT(*) FROM remote_request'));
    }

    public function testDeletedRequestIsExpiredOnlyIfItsIdIsOlderThanItsLifetime(): void
    {
        [, $controller] = $this->accountWithTwoDevices();

        $old = new UuidV7(UuidV7::generate(new \DateTimeImmutable('-2 minutes')));
        $this->getJson("/api/remote-requests/$old", self::auth($controller));
        self::assertResponseStatusCodeSame(410);

        $recent = new UuidV7();
        $this->getJson("/api/remote-requests/$recent", self::auth($controller));
        self::assertResponseStatusCodeSame(404);
        self::assertSame('remote_request_not_found', $this->errorCode());
    }

    public function testOnlyTheCreatingSessionReadsTheAnswer(): void
    {
        [, $controller] = $this->accountWithTwoDevices();
        $id = $this->requestSession($controller)['id'];
        $other = $this->login(deviceName: 'Tableta');

        $this->getJson("/api/remote-requests/$id", self::auth($other));

        self::assertResponseStatusCodeSame(404);
    }

    public function testAnswerNeedsTheDeviceKey(): void
    {
        [, $controller] = $this->accountWithTwoDevices();
        $id = $this->requestSession($controller)['id'];

        // Otro equipo de la misma cuenta no puede responder en nombre del PC
        $this->putJson("/api/remote-requests/$id/answer", ['answer' => self::ANSWER], self::deviceAuth($controller, 'otra-clave_0123456789abcdefghijABCDEFGH'));

        self::assertResponseStatusCodeSame(403);
        self::assertSame('device_key_invalid', $this->errorCode());
        self::assertSame(['status' => 'pending'], $this->getJson("/api/remote-requests/$id", self::auth($controller)));
    }

    public function testOtherAccountsCannotReachDevicesOrRequests(): void
    {
        [, $controller] = $this->accountWithTwoDevices();
        $id = $this->requestSession($controller)['id'];
        $luis = $this->register('luis@ejemplo.com')['token'];

        $this->postJson('/api/devices/'.self::DEVICE_ID.'/remote-requests', ['offer' => self::OFFER], self::auth($luis));
        self::assertResponseStatusCodeSame(404);
        self::assertSame('device_not_found', $this->errorCode());

        $this->getJson("/api/remote-requests/$id", self::auth($luis));
        self::assertResponseStatusCodeSame(404);

        $this->putJson("/api/remote-requests/$id/answer", ['answer' => self::ANSWER], self::deviceAuth($luis));
        self::assertResponseStatusCodeSame(404);

        $this->getJson('/api/devices/'.self::DEVICE_ID.'/remote-requests', self::deviceAuth($luis));
        self::assertResponseStatusCodeSame(404);
    }

    /** @return iterable<string, array{string, array<string, mixed>, string}> */
    public static function invalidBodies(): iterable
    {
        yield 'oferta vacía' => ['offer', ['offer' => ''], 'offer'];
        yield 'oferta demasiado grande' => ['offer', ['offer' => str_repeat('a', 65537)], 'offer'];
        yield 'respuesta que no es texto' => ['answer', ['answer' => ['sdp']], 'answer'];
        yield 'motivo desconocido' => ['answer', ['rejected' => ['reason' => 'porque sí']], 'rejected.reason'];
        yield 'espera negativa' => ['answer', ['rejected' => ['reason' => 'locked', 'retryAfter' => -5]], 'rejected.retryAfter'];
    }

    #[DataProvider('invalidBodies')]
    public function testInvalidBodiesAreRejected(string $endpoint, array $body, string $field): void
    {
        [$host, $controller] = $this->accountWithTwoDevices();
        if ('offer' === $endpoint) {
            $this->postJson('/api/devices/'.self::DEVICE_ID.'/remote-requests', $body, self::auth($controller));
        } else {
            $id = $this->requestSession($controller)['id'];
            $this->putJson("/api/remote-requests/$id/answer", $body, self::deviceAuth($host));
        }

        self::assertResponseStatusCodeSame(400);
        self::assertSame('remote_request_invalid', $this->errorCode());
        self::assertSame(['field' => $field], $this->json()['error']['details']);
    }

    public function testAccountIsLimitedTo20RequestsPerMinute(): void
    {
        [, $controller] = $this->accountWithTwoDevices();
        for ($i = 0; $i < 20; ++$i) {
            $this->requestSession($controller);
            self::assertResponseStatusCodeSame(201);
        }

        $this->requestSession($controller);

        self::assertResponseStatusCodeSame(429);
        self::assertSame('too_many_requests', $this->errorCode());
        self::assertGreaterThan(0, $this->json()['error']['details']['retryAfter']);
        self::assertResponseHasHeader('Retry-After');
    }

    public function testDeviceCanPollOncePerSecond(): void
    {
        [$host] = $this->accountWithTwoDevices();
        $this->poll($host);
        self::assertResponseIsSuccessful();

        $this->poll($host);

        self::assertResponseStatusCodeSame(429);
        self::assertSame('too_many_requests', $this->errorCode());
    }

    public function testPollingKeepsTheDeviceOnline(): void
    {
        [$host, $controller] = $this->accountWithTwoDevices();
        $this->setLastSeen(self::DEVICE_ID, '-25 seconds');

        $this->poll($host);

        self::assertTrue($this->getJson('/api/devices', self::auth($controller))['devices'][0]['online']);
        $lastSeen = new \DateTimeImmutable($this->getJson('/api/devices', self::auth($controller))['devices'][0]['lastSeenAt']);
        self::assertGreaterThan(new \DateTimeImmutable('-5 seconds'), $lastSeen);
    }

    /** El PC registrado (sesión "Portátil") y otra sesión de la misma cuenta que controla ("Oficina"). */
    private function accountWithTwoDevices(): array
    {
        $host = $this->register()['token'];
        $this->putDevice($host);
        $controller = $this->login(deviceName: 'Oficina');

        return [$host, $controller];
    }

    private function requestSession(string $controller): array
    {
        return $this->postJson('/api/devices/'.self::DEVICE_ID.'/remote-requests', ['offer' => self::OFFER], self::auth($controller));
    }

    private function poll(string $host): array
    {
        return $this->getJson('/api/devices/'.self::DEVICE_ID.'/remote-requests', self::deviceAuth($host));
    }

    /** Los límites viven en cache_items (y cada test se deshace al acabar). */
    private function resetLimits(): void
    {
        $this->db()->executeStatement('DELETE FROM cache_items');
    }
}
