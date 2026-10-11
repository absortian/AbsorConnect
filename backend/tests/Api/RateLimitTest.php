<?php

namespace App\Tests\Api;

use App\Tests\ApiTestCase;

/**
 * Escenarios de "Límites contra abusos". Los contadores viven en Postgres
 * (cache_items), así que el rollback de cada test los deja a cero.
 */
final class RateLimitTest extends ApiTestCase
{
    public function testSixthFailedLoginForTheSameEmailIsRejected(): void
    {
        $this->register();
        for ($i = 0; $i < 5; ++$i) {
            $this->postJson('/api/auth/login', ['email' => 'ana@ejemplo.com', 'password' => 'mal-'.$i, 'deviceName' => 'x']);
            self::assertResponseStatusCodeSame(401);
        }

        // Ni siquiera con la contraseña correcta
        $this->postJson('/api/auth/login', ['email' => 'ANA@ejemplo.com', 'password' => self::PASSWORD, 'deviceName' => 'x']);

        self::assertResponseStatusCodeSame(429);
        self::assertSame('too_many_attempts', $this->errorCode());
        self::assertGreaterThan(0, (int) $this->client->getResponse()->headers->get('Retry-After'));
    }

    public function testSuccessfulLoginResetsTheFailures(): void
    {
        $this->register();
        for ($round = 0; $round < 2; ++$round) {
            for ($i = 0; $i < 4; ++$i) {
                $this->postJson('/api/auth/login', ['email' => 'ana@ejemplo.com', 'password' => 'mal', 'deviceName' => 'x']);
                self::assertResponseStatusCodeSame(401);
            }
            $this->login();
        }
    }

    public function testLoginsFromOneIpAreLimited(): void
    {
        for ($i = 0; $i < 30; ++$i) {
            $this->postJson('/api/auth/login', ['email' => "persona$i@ejemplo.com", 'password' => self::PASSWORD, 'deviceName' => 'x']);
            self::assertResponseStatusCodeSame(401);
        }

        $this->postJson('/api/auth/login', ['email' => 'otra@ejemplo.com', 'password' => self::PASSWORD, 'deviceName' => 'x']);

        self::assertResponseStatusCodeSame(429);
    }

    public function testSixthRegistrationFromTheSameIpIsRejected(): void
    {
        for ($i = 0; $i < 5; ++$i) {
            $this->register("persona$i@ejemplo.com");
        }

        $this->postJson('/api/auth/register', ['email' => 'sexta@ejemplo.com', 'password' => self::PASSWORD, 'deviceName' => 'x']);

        self::assertResponseStatusCodeSame(429);
        self::assertSame('too_many_attempts', $this->errorCode());
        self::assertSame(5, (int) $this->db()->fetchOne('SELECT COUNT(*) FROM app_user'));
    }

    public function testForwardedForFromAnUntrustedClientIsIgnored(): void
    {
        for ($i = 0; $i < 5; ++$i) {
            $this->postJson('/api/auth/register', ['email' => "persona$i@ejemplo.com", 'password' => self::PASSWORD, 'deviceName' => 'x'], ['X-Forwarded-For' => "203.0.113.$i"]);
            self::assertResponseStatusCodeSame(201);
        }

        $this->postJson('/api/auth/register', ['email' => 'sexta@ejemplo.com', 'password' => self::PASSWORD, 'deviceName' => 'x'], ['X-Forwarded-For' => '203.0.113.99']);

        self::assertResponseStatusCodeSame(429);
    }

    public function testCountersAreSharedThroughTheDatabase(): void
    {
        $this->postJson('/api/auth/login', ['email' => 'nadie@ejemplo.com', 'password' => 'x', 'deviceName' => 'x']);

        // Todas las réplicas ven el mismo contador: no está en la memoria del pod
        self::assertGreaterThan(0, (int) $this->db()->fetchOne('SELECT COUNT(*) FROM cache_items'));
    }
}
