<?php

namespace App\Tests\Api;

use App\Security\SessionManager;
use App\Tests\ApiTestCase;

/** Token válido, caducado, revocado e inexistente, y caducidad deslizante (D3). */
final class AccessTokenTest extends ApiTestCase
{
    public function testValidToken(): void
    {
        $token = $this->register()['token'];

        $this->getJson('/api/me', self::auth($token));

        self::assertResponseIsSuccessful();
    }

    public function testMissingToken(): void
    {
        $this->getJson('/api/me');

        self::assertResponseStatusCodeSame(401);
        self::assertSame('unauthenticated', $this->errorCode());
        self::assertResponseHeaderSame('WWW-Authenticate', 'Bearer');
    }

    public function testExpiredToken(): void
    {
        $token = $this->register()['token'];
        $this->setSessionTimes($token, lastUsedAt: '-91 days', expiresAt: '-1 minute');

        $this->getJson('/api/me', self::auth($token));

        self::assertResponseStatusCodeSame(401);
        self::assertSame('unauthenticated', $this->errorCode());
    }

    public function testRevokedToken(): void
    {
        $token = $this->register()['token'];
        $this->db()->executeStatement('DELETE FROM user_session');

        $this->getJson('/api/me', self::auth($token));

        self::assertResponseStatusCodeSame(401);
        self::assertSame('unauthenticated', $this->errorCode());
    }

    public function testUnknownTokens(): void
    {
        $this->register();

        foreach (['acs_'.str_repeat('A', 43), 'no-prefix-token', 'acs_'.str_repeat('A', 500)] as $token) {
            $this->getJson('/api/me', self::auth($token));
            self::assertResponseStatusCodeSame(401);
            self::assertSame('unauthenticated', $this->errorCode());
        }
    }

    public function testExpiryIsExtendedWhenUsedAfterAnHour(): void
    {
        $token = $this->register()['token'];
        $this->setSessionTimes($token, lastUsedAt: '-2 hours', expiresAt: '+1 day');

        $this->getJson('/api/me', self::auth($token));

        self::assertResponseIsSuccessful();
        $expiresAt = new \DateTimeImmutable($this->sessionRow($token)['expires_at']);
        self::assertEqualsWithDelta((new \DateTimeImmutable('+90 days'))->getTimestamp(), $expiresAt->getTimestamp(), 60);
    }

    public function testExpiryIsNotWrittenOnEveryRequest(): void
    {
        $token = $this->register()['token'];
        $this->setSessionTimes($token, lastUsedAt: '-10 minutes', expiresAt: '+1 day');
        $before = $this->sessionRow($token);

        $this->getJson('/api/me', self::auth($token));

        self::assertResponseIsSuccessful();
        self::assertSame($before, $this->sessionRow($token));
    }

    public function testLoginPurgesExpiredSessionsOfThatAccount(): void
    {
        $old = $this->register()['token'];
        $this->setSessionTimes($old, lastUsedAt: '-100 days', expiresAt: '-10 days');

        $this->login();

        self::assertFalse($this->db()->fetchOne('SELECT 1 FROM user_session WHERE token_hash = ?', [SessionManager::hash($old)]));
        self::assertSame(1, (int) $this->db()->fetchOne('SELECT COUNT(*) FROM user_session'));
    }

    private function setSessionTimes(string $token, string $lastUsedAt, string $expiresAt): void
    {
        $this->db()->executeStatement(
            'UPDATE user_session SET last_used_at = ?, expires_at = ? WHERE token_hash = ?',
            [(new \DateTimeImmutable($lastUsedAt))->format('Y-m-d H:i:s'), (new \DateTimeImmutable($expiresAt))->format('Y-m-d H:i:s'), SessionManager::hash($token)],
        );
        $this->em->clear();
    }

    /** @return array<string, mixed> */
    private function sessionRow(string $token): array
    {
        return $this->db()->fetchAssociative('SELECT last_used_at, expires_at FROM user_session WHERE token_hash = ?', [SessionManager::hash($token)]);
    }
}
