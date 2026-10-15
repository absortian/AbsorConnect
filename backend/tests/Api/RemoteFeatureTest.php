<?php

namespace App\Tests\Api;

use App\Tests\ApiTestCase;

/** Interruptor general del control remoto y borrado de sus datos con la cuenta. */
final class RemoteFeatureTest extends ApiTestCase
{
    private ?string $savedEnabled = null;

    protected function tearDown(): void
    {
        $_ENV['REMOTE_ENABLED'] = $_SERVER['REMOTE_ENABLED'] = $this->savedEnabled ?? '1';
        parent::tearDown();
    }

    public function testDisabledFeatureAnswers503OnEveryEndpoint(): void
    {
        $token = $this->register()['token'];
        $this->savedEnabled = $_ENV['REMOTE_ENABLED'] ?? '1';
        $_ENV['REMOTE_ENABLED'] = $_SERVER['REMOTE_ENABLED'] = '0';

        foreach (['/api/devices', '/api/remote/ice-servers', '/api/remote-requests/0199e3a0-1c2d-7a00-8000-0000000000d4'] as $url) {
            $this->getJson($url, self::auth($token));
            self::assertResponseStatusCodeSame(503, $url);
            self::assertSame('remote_unavailable', $this->errorCode());
        }
        // Lo demás de la API sigue funcionando
        $this->getJson('/api/connections', self::auth($token));
        self::assertResponseIsSuccessful();
    }

    public function testDeletingTheAccountDeletesItsDevicesAndRequests(): void
    {
        $host = $this->register()['token'];
        $this->putDevice($host);
        $controller = $this->login(deviceName: 'Oficina');
        $this->postJson('/api/devices/'.self::DEVICE_ID.'/remote-requests', ['offer' => 'v=0'], self::auth($controller));
        self::assertResponseStatusCodeSame(201);

        $this->deleteJson('/api/me', ['password' => self::PASSWORD], self::auth($host));
        self::assertResponseStatusCodeSame(204);

        self::assertSame(0, (int) $this->db()->fetchOne('SELECT COUNT(*) FROM device'));
        self::assertSame(0, (int) $this->db()->fetchOne('SELECT COUNT(*) FROM remote_request'));
    }
}
