<?php

namespace App\Tests\Api;

use App\Tests\ApiTestCase;
use PHPUnit\Framework\Attributes\DataProvider;

/** Escenarios de "Equipos de la cuenta", "Estado en línea" y "Retirada de equipos" (remote-signaling). */
final class DevicesTest extends ApiTestCase
{
    public function testRegisteredDeviceAppearsInTheList(): void
    {
        $token = $this->register()['token'];

        $device = $this->putDevice($token);
        self::assertResponseIsSuccessful();
        $list = $this->getJson('/api/devices', self::auth($token));

        self::assertSame([$device], $list['devices']);
        self::assertSame(self::DEVICE_ID, $device['id']);
        self::assertSame('Sobremesa de casa', $device['name']);
        self::assertSame('linux', $device['platform']);
        self::assertSame('0.4.0', $device['appVersion']);
        self::assertTrue($device['online']);
        self::assertSame(['state' => 'available', 'features' => ['clipboard' => true, 'files' => true, 'audio' => false]], $device['remote']);
    }

    public function testUpdatingKeepsASingleDevice(): void
    {
        $token = $this->register()['token'];
        $this->putDevice($token);

        $this->putDevice($token, info: ['name' => 'Oficina', 'remote' => ['state' => 'disabled']]);
        self::assertResponseIsSuccessful();
        $list = $this->getJson('/api/devices', self::auth($token))['devices'];

        self::assertCount(1, $list);
        self::assertSame('Oficina', $list[0]['name']);
        self::assertSame('disabled', $list[0]['remote']['state']);
    }

    public function testIdOfAnotherAccountIsTaken(): void
    {
        $ana = $this->register('ana@ejemplo.com')['token'];
        $luis = $this->register('luis@ejemplo.com')['token'];
        $this->putDevice($ana);

        $this->putDevice($luis, key: 'otra-clave_0123456789abcdefghijABCDEFGH', info: ['name' => 'De Luis']);

        self::assertResponseStatusCodeSame(409);
        self::assertSame('device_taken', $this->errorCode());
        self::assertSame('Sobremesa de casa', $this->getJson('/api/devices', self::auth($ana))['devices'][0]['name']);
        self::assertSame([], $this->getJson('/api/devices', self::auth($luis))['devices']);
    }

    public function testOtherSessionOfTheSameAccountNeedsTheDeviceKey(): void
    {
        $this->putDevice($this->register()['token']);
        $phone = $this->login(deviceName: 'Móvil');

        $this->putDevice($phone, key: 'otra-clave_0123456789abcdefghijABCDEFGH', info: ['name' => 'Suplantado']);
        self::assertResponseStatusCodeSame(403);
        self::assertSame('device_key_invalid', $this->errorCode());

        // Con la clave sí: es el mismo PC tras iniciar sesión de nuevo
        $this->putDevice($phone, info: ['name' => 'Sobremesa renombrado']);
        self::assertResponseIsSuccessful();
        self::assertSame('Sobremesa renombrado', $this->getJson('/api/devices', self::auth($phone))['devices'][0]['name']);
    }

    public function testMissingOrMalformedKeyIsRejected(): void
    {
        $token = $this->register()['token'];

        $this->putJson('/api/devices/'.self::DEVICE_ID, self::deviceInfo(), self::auth($token));
        self::assertResponseStatusCodeSame(403);
        self::assertSame('device_key_invalid', $this->errorCode());

        $this->putDevice($token, key: 'corta');
        self::assertResponseStatusCodeSame(403);
        self::assertSame([], $this->getJson('/api/devices', self::auth($token))['devices']);
    }

    /** @return iterable<string, array{array<string, mixed>, string}> */
    public static function invalidInfo(): iterable
    {
        yield 'nombre vacío' => [['name' => '  '], 'name'];
        yield 'nombre demasiado largo' => [['name' => str_repeat('x', 101)], 'name'];
        yield 'sistema desconocido' => [['platform' => 'android'], 'platform'];
        yield 'versión con espacios' => [['appVersion' => '1.0 beta'], 'appVersion'];
        yield 'estado desconocido' => [['remote' => ['state' => 'online']], 'remote.state'];
        yield 'función sin booleano' => [['remote' => ['features' => ['files' => 'sí']]], 'remote.features.files'];
    }

    #[DataProvider('invalidInfo')]
    public function testInvalidInfoIsRejected(array $overrides, string $field): void
    {
        $token = $this->register()['token'];

        $this->putDevice($token, info: $overrides);

        self::assertResponseStatusCodeSame(400);
        self::assertSame('device_invalid', $this->errorCode());
        self::assertSame(['field' => $field], $this->json()['error']['details']);
    }

    public function testOnlineDependsOnTheLastContact(): void
    {
        $token = $this->register()['token'];
        $this->putDevice($token);

        $this->setLastSeen(self::DEVICE_ID, '-20 seconds');
        self::assertTrue($this->getJson('/api/devices', self::auth($token))['devices'][0]['online']);

        // Escenario "App cerrada": a los 30 segundos sin contacto aparece sin conexión
        $this->setLastSeen(self::DEVICE_ID, '-40 seconds');
        self::assertFalse($this->getJson('/api/devices', self::auth($token))['devices'][0]['online']);
    }

    public function testRemoveNeedsTheKeyAndDeletesTheDevice(): void
    {
        $token = $this->register()['token'];
        $this->putDevice($token);

        $this->deleteJson('/api/devices/'.self::DEVICE_ID, headers: self::deviceAuth($token, 'otra-clave_0123456789abcdefghijABCDEFGH'));
        self::assertResponseStatusCodeSame(403);

        $this->deleteJson('/api/devices/'.self::DEVICE_ID, headers: self::deviceAuth($token));
        self::assertResponseStatusCodeSame(204);
        self::assertSame([], $this->getJson('/api/devices', self::auth($token))['devices']);

        $this->deleteJson('/api/devices/'.self::DEVICE_ID, headers: self::deviceAuth($token));
        self::assertResponseStatusCodeSame(404);
        self::assertSame('device_not_found', $this->errorCode());
    }

    public function testDevicesNotSeenFor90DaysAreForgotten(): void
    {
        $token = $this->register()['token'];
        $this->putDevice($token);
        $this->setLastSeen(self::DEVICE_ID, '-91 days');

        $this->putDevice($token, '0199e3a0-1c2d-7a00-8000-0000000000b2', info: ['name' => 'Portátil']);

        self::assertSame(['Portátil'], array_column($this->getJson('/api/devices', self::auth($token))['devices'], 'name'));
    }
}
