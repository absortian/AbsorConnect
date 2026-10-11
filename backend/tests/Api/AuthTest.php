<?php

namespace App\Tests\Api;

use App\Security\SessionManager;
use App\Tests\ApiTestCase;
use PHPUnit\Framework\Attributes\DataProvider;

/** Escenarios de "Registro abierto", "Inicio de sesión por dispositivo" y "Cierre de sesión". */
final class AuthTest extends ApiTestCase
{
    public function testRegisterNormalizesEmailAndStartsASession(): void
    {
        $body = $this->register('Ana@Ejemplo.com', 'doce-chars!!');

        self::assertSame('ana@ejemplo.com', $body['user']['email']);
        self::assertStringStartsWith('acs_', $body['token']);

        $me = $this->getJson('/api/me', self::auth($body['token']));
        self::assertResponseIsSuccessful();
        self::assertSame(['id' => $body['user']['id'], 'email' => 'ana@ejemplo.com'], ['id' => $me['id'], 'email' => $me['email']]);
        self::assertArrayHasKey('createdAt', $me);
    }

    public function testEmailIsUniqueIgnoringCase(): void
    {
        $this->register('ana@ejemplo.com');

        $this->postJson('/api/auth/register', ['email' => 'ANA@ejemplo.com', 'password' => self::PASSWORD, 'deviceName' => 'x']);

        self::assertResponseStatusCodeSame(409);
        self::assertSame('email_taken', $this->errorCode());
        self::assertSame(1, (int) $this->db()->fetchOne('SELECT COUNT(*) FROM app_user'));
    }

    #[DataProvider('invalidRegistrations')]
    public function testInvalidRegistrationCreatesNothing(array $payload, string $code): void
    {
        $this->postJson('/api/auth/register', $payload + ['deviceName' => 'x']);

        self::assertResponseStatusCodeSame(400);
        self::assertSame($code, $this->errorCode());
        self::assertSame(0, (int) $this->db()->fetchOne('SELECT COUNT(*) FROM app_user'));
    }

    public static function invalidRegistrations(): iterable
    {
        yield 'email mal formado' => [['email' => 'ana@', 'password' => self::PASSWORD], 'email_invalid'];
        yield 'email sin dominio' => [['email' => 'ana', 'password' => self::PASSWORD], 'email_invalid'];
        yield 'sin email' => [['password' => self::PASSWORD], 'email_invalid'];
        yield 'contraseña de 9' => [['email' => 'ana@ejemplo.com', 'password' => '123456789'], 'password_too_short'];
        yield 'sin contraseña' => [['email' => 'ana@ejemplo.com'], 'password_too_short'];
        yield 'contraseña enorme' => [['email' => 'ana@ejemplo.com', 'password' => str_repeat('a', 4097)], 'password_too_long'];
    }

    public function testEachLoginIsAnIndependentSession(): void
    {
        $first = $this->register()['token'];
        $second = $this->login();

        self::assertNotSame($first, $second);
        foreach ([$first, $second] as $token) {
            $this->getJson('/api/me', self::auth($token));
            self::assertResponseIsSuccessful();
        }
        self::assertSame(2, (int) $this->db()->fetchOne('SELECT COUNT(*) FROM user_session'));
    }

    public function testLoginIsCaseInsensitive(): void
    {
        $this->register('ana@ejemplo.com');

        $this->login(' Ana@Ejemplo.COM ');
        self::assertResponseIsSuccessful();
    }

    public function testWrongPasswordAndUnknownEmailGiveTheSameError(): void
    {
        $this->register();

        $wrongPassword = $this->postJson('/api/auth/login', ['email' => 'ana@ejemplo.com', 'password' => 'otra-contraseña', 'deviceName' => 'x']);
        $wrongStatus = $this->client->getResponse()->getStatusCode();
        $unknownEmail = $this->postJson('/api/auth/login', ['email' => 'nadie@ejemplo.com', 'password' => self::PASSWORD, 'deviceName' => 'x']);

        self::assertResponseStatusCodeSame(401);
        self::assertSame(401, $wrongStatus);
        self::assertSame(['error' => ['code' => 'invalid_credentials']], $wrongPassword);
        self::assertSame($wrongPassword, $unknownEmail);
    }

    public function testTokenIsStoredOnlyAsItsHash(): void
    {
        $token = $this->register()['token'];

        $row = $this->db()->fetchAssociative('SELECT * FROM user_session');
        self::assertSame(SessionManager::hash($token), $row['token_hash']);
        self::assertStringNotContainsString($token, implode('|', array_map('strval', $row)));
        self::assertSame('Portátil', $row['device_name']);
    }

    public function testStaleTokenDoesNotBlockLoginOrRegistration(): void
    {
        $this->register();
        $stale = self::auth('acs_'.str_repeat('x', 43));

        $this->postJson('/api/auth/login', ['email' => 'ana@ejemplo.com', 'password' => self::PASSWORD, 'deviceName' => 'x'], $stale);
        self::assertResponseIsSuccessful();
        $this->postJson('/api/auth/register', ['email' => 'luis@ejemplo.com', 'password' => self::PASSWORD, 'deviceName' => 'x'], $stale);
        self::assertResponseStatusCodeSame(201);
        $this->getJson('/api/health', $stale);
        self::assertResponseIsSuccessful();
    }

    public function testLogoutRevokesOnlyThatDevice(): void
    {
        $laptop = $this->register()['token'];
        $desktop = $this->login();

        $this->client->request('POST', '/api/auth/logout', server: ['HTTP_AUTHORIZATION' => 'Bearer '.$laptop]);
        self::assertResponseStatusCodeSame(204);

        $this->getJson('/api/me', self::auth($laptop));
        self::assertResponseStatusCodeSame(401);
        $this->getJson('/api/me', self::auth($desktop));
        self::assertResponseIsSuccessful();
    }

    public function testMalformedJsonIsRejected(): void
    {
        $this->client->request('POST', '/api/auth/login', server: ['CONTENT_TYPE' => 'application/json'], content: '{"email": ');

        self::assertResponseStatusCodeSame(400);
        self::assertSame('invalid_json', $this->errorCode());
    }

    public function testJsonThatIsNotAnObjectIsRejected(): void
    {
        $this->client->request('POST', '/api/auth/login', server: ['CONTENT_TYPE' => 'application/json'], content: '["ana@ejemplo.com"]');

        self::assertResponseStatusCodeSame(400);
        self::assertSame('invalid_json', $this->errorCode());
    }

    public function testUnknownApiRouteIsJson(): void
    {
        $this->getJson('/api/nope');

        self::assertResponseStatusCodeSame(404);
        self::assertSame('not_found', $this->errorCode());
    }
}
