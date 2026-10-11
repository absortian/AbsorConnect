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
