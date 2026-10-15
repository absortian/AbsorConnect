<?php

namespace App\Tests;

use Doctrine\DBAL\Connection;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;

/** Base con utilidades para los tests funcionales de la API. */
abstract class ApiTestCase extends WebTestCase
{
    protected const string PASSWORD = 'contraseña-de-prueba';

    protected KernelBrowser $client;
    protected EntityManagerInterface $em;

    protected function setUp(): void
    {
        $this->client = static::createClient();
        $this->em = static::getContainer()->get(EntityManagerInterface::class);
    }

    /** @return array{token: string, user: array{id: string, email: string}} */
    protected function register(string $email = 'ana@ejemplo.com', string $password = self::PASSWORD, string $deviceName = 'Portátil'): array
    {
        $body = $this->postJson('/api/auth/register', ['email' => $email, 'password' => $password, 'deviceName' => $deviceName]);
        self::assertResponseStatusCodeSame(201);

        return $body;
    }

    protected function login(string $email = 'ana@ejemplo.com', string $password = self::PASSWORD, string $deviceName = 'Sobremesa'): string
    {
        $body = $this->postJson('/api/auth/login', ['email' => $email, 'password' => $password, 'deviceName' => $deviceName]);
        self::assertResponseStatusCodeSame(200);

        return $body['token'];
    }

    /** @return array<string, string> */
    protected static function auth(string $token): array
    {
        return ['Authorization' => 'Bearer '.$token];
    }

    protected const string DEVICE_ID = '0199e3a0-1c2d-7a00-8000-0000000000a1';
    protected const string DEVICE_KEY = 'k-prueba_0123456789abcdefghijABCDEFGHIJ';

    /** @return array<string, string> */
    protected static function deviceAuth(string $token, string $key = self::DEVICE_KEY): array
    {
        return self::auth($token) + ['X-Device-Key' => $key];
    }

    /** Datos de un equipo como los publica la app, con lo que se quiera cambiar. */
    protected static function deviceInfo(array $overrides = []): array
    {
        return array_replace_recursive([
            'name' => 'Sobremesa de casa',
            'platform' => 'linux',
            'appVersion' => '0.4.0',
            'remote' => ['state' => 'available', 'features' => ['clipboard' => true, 'files' => true, 'audio' => false]],
        ], $overrides);
    }

    protected function putDevice(string $token, string $id = self::DEVICE_ID, string $key = self::DEVICE_KEY, array $info = []): array
    {
        return $this->putJson("/api/devices/$id", self::deviceInfo($info), self::deviceAuth($token, $key));
    }

    /** Fija la última señal de vida de un equipo, con la hora calculada en PHP (UTC). */
    protected function setLastSeen(string $id, string $modifier): void
    {
        $this->db()->executeStatement('UPDATE device SET last_seen_at = ? WHERE id = ?', [
            (new \DateTimeImmutable($modifier))->format('Y-m-d H:i:s'),
            $id,
        ]);
    }

    protected function errorCode(): ?string
    {
        return $this->json()['error']['code'] ?? null;
    }

    protected function db(): Connection
    {
        return $this->em->getConnection();
    }

    protected function postJson(string $url, array $payload = [], array $headers = []): array
    {
        $this->client->request('POST', $url, server: $this->headers($headers), content: json_encode($payload, JSON_THROW_ON_ERROR));

        return $this->json();
    }

    protected function putJson(string $url, array $payload = [], array $headers = []): array
    {
        $this->client->request('PUT', $url, server: $this->headers($headers), content: json_encode($payload, JSON_THROW_ON_ERROR));

        return $this->json();
    }

    protected function getJson(string $url, array $headers = []): array
    {
        $this->client->request('GET', $url, server: $this->headers($headers));

        return $this->json();
    }

    protected function deleteJson(string $url, array $payload = [], array $headers = []): array
    {
        $this->client->request('DELETE', $url, server: $this->headers($headers), content: json_encode($payload, JSON_THROW_ON_ERROR));

        return $this->json();
    }

    protected function json(): array
    {
        $content = $this->client->getResponse()->getContent();
        if (false === $content || '' === $content) {
            return [];
        }

        return json_decode($content, true, 64, JSON_THROW_ON_ERROR) ?? [];
    }

    private function headers(array $headers): array
    {
        $server = ['CONTENT_TYPE' => 'application/json', 'HTTP_ACCEPT' => 'application/json'];
        foreach ($headers as $key => $value) {
            $server['HTTP_'.strtoupper(str_replace('-', '_', $key))] = $value;
        }

        return $server;
    }
}
