<?php

namespace App\Tests\Api;

use App\Account\AccountService;
use App\Entity\User;
use App\Security\SessionManager;
use App\Tests\ApiTestCase;
use PHPUnit\Framework\Attributes\DataProvider;

final class HostAgentTest extends ApiTestCase
{
    private const array AGENT_INFO = ['agentVersion' => '0.1.0', 'capabilities' => ['restart' => true]];
    private const string SECOND_DEVICE = '0199e3a0-1c2d-7a00-8000-0000000000a2';

    private function enrollment(string $host, string $id = self::DEVICE_ID): array
    {
        $result = $this->postJson("/api/devices/$id/agent-enrollments", [], self::deviceAuth($host));
        self::assertResponseStatusCodeSame(201);

        return $result;
    }

    private function agent(?string &$host = null): string
    {
        $host = $this->register()['token'];
        $this->putDevice($host);
        $enrollment = $this->enrollment($host);
        $result = $this->postJson('/api/host-agent/enroll', ['enrollmentToken' => $enrollment['enrollmentToken']] + self::AGENT_INFO);
        self::assertResponseStatusCodeSame(201);

        return $result['token'];
    }

    public function testEnrollmentIsBoundSingleUseHashedAndFiveMinutes(): void
    {
        $host = $this->register()['token'];
        $this->putDevice($host);
        $enrollment = $this->enrollment($host);
        self::assertGreaterThan(new \DateTimeImmutable('+290 seconds'), new \DateTimeImmutable($enrollment['expiresAt']));
        self::assertLessThanOrEqual(new \DateTimeImmutable('+300 seconds'), new \DateTimeImmutable($enrollment['expiresAt']));
        self::assertSame(hash('sha256', $enrollment['enrollmentToken']), $this->db()->fetchOne('SELECT token_hash FROM agent_enrollment'));
        $before = $this->db()->fetchAssociative('SELECT last_used_at, expires_at FROM user_session WHERE token_hash = ?', [SessionManager::hash($host)]);
        $result = $this->postJson('/api/host-agent/enroll', ['enrollmentToken' => $enrollment['enrollmentToken']] + self::AGENT_INFO);
        self::assertResponseStatusCodeSame(201);
        self::assertStringStartsWith('acg_', $result['token']);
        self::assertSame(self::DEVICE_ID, $result['deviceId']);
        self::assertSame(hash('sha256', $result['token']), $this->db()->fetchOne('SELECT token_hash FROM host_agent'));
        self::assertSame(0, (int) $this->db()->fetchOne('SELECT COUNT(*) FROM agent_enrollment'));
        $poll = $this->getJson('/api/host-agent/remote-requests', self::auth($result['token']));
        self::assertResponseIsSuccessful();
        self::assertSame([], $poll['requests']);
        self::assertSame(30, $poll['authorization']['validForSeconds']);
        self::assertLessThanOrEqual(new \DateTimeImmutable('+30 seconds'), new \DateTimeImmutable($poll['authorization']['authorizedUntil']));
        self::assertSame($before, $this->db()->fetchAssociative('SELECT last_used_at, expires_at FROM user_session WHERE token_hash = ?', [SessionManager::hash($host)]));
        $this->postJson('/api/host-agent/enroll', ['enrollmentToken' => $enrollment['enrollmentToken']] + self::AGENT_INFO);
        self::assertResponseStatusCodeSame(400);
        self::assertSame('agent_enrollment_invalid', $this->errorCode());
        self::assertSame(1, (int) $this->db()->fetchOne('SELECT COUNT(*) FROM host_agent'));
    }

    public function testExpiredAndSupersededEnrollmentsCannotBeRedeemed(): void
    {
        $host = $this->register()['token'];
        $this->putDevice($host);
        $first = $this->enrollment($host);
        $second = $this->enrollment($host);
        $this->postJson('/api/host-agent/enroll', ['enrollmentToken' => $first['enrollmentToken']] + self::AGENT_INFO);
        self::assertResponseStatusCodeSame(400);
        $this->db()->executeStatement('UPDATE agent_enrollment SET expires_at = ?', [(new \DateTimeImmutable('-1 second'))->format('Y-m-d H:i:s')]);
        $this->postJson('/api/host-agent/enroll', ['enrollmentToken' => $second['enrollmentToken']] + self::AGENT_INFO);
        self::assertResponseStatusCodeSame(400);
        self::assertSame(0, (int) $this->db()->fetchOne('SELECT COUNT(*) FROM host_agent'));
    }

    public function testEnrollmentRequiresAccountOwnershipAndDeviceKey(): void
    {
        $host = $this->register()['token'];
        $this->putDevice($host);
        $other = $this->register('otra@ejemplo.com')['token'];
        $this->postJson('/api/devices/'.self::DEVICE_ID.'/agent-enrollments', [], self::deviceAuth($other));
        self::assertResponseStatusCodeSame(404);
        $this->postJson('/api/devices/'.self::DEVICE_ID.'/agent-enrollments', [], self::deviceAuth($host, str_repeat('x', 40)));
        self::assertResponseStatusCodeSame(403);
        self::assertSame(0, (int) $this->db()->fetchOne('SELECT COUNT(*) FROM agent_enrollment'));
    }

    public function testAgentCannotUseAccountOrControllerEndpoints(): void
    {
        $agent = $this->agent();
        foreach (['/api/me', '/api/connections', '/api/devices', '/api/remote/ice-servers'] as $path) {
            $this->getJson($path, self::auth($agent));
            self::assertResponseStatusCodeSame(401, $path);
        }
        $this->postJson('/api/devices/'.self::DEVICE_ID.'/remote-requests', ['offer' => 'v=0'], self::auth($agent));
        self::assertResponseStatusCodeSame(401);
        $this->putDevice($agent);
        self::assertResponseStatusCodeSame(401);
        $this->postJson('/api/devices/'.self::DEVICE_ID.'/agent-enrollments', [], self::deviceAuth($agent));
        self::assertResponseStatusCodeSame(401);
    }

    public function testAccountCredentialCannotActAsAgent(): void
    {
        $this->agent($host);
        $this->getJson('/api/host-agent/remote-requests', self::auth($host));
        self::assertResponseStatusCodeSame(401);
        $this->getJson('/api/host-agent/ice-servers');
        self::assertResponseStatusCodeSame(401);
    }

    public function testAgentAnswersOnlyItsOwnRequestsAndPublishesOptionalMetadata(): void
    {
        $agent = $this->agent($host);
        $this->putDevice($host, self::SECOND_DEVICE);
        $controller = $this->login();
        $created = $this->postJson('/api/devices/'.self::DEVICE_ID.'/remote-requests', ['offer' => 'v=0'], self::auth($controller));
        self::assertResponseStatusCodeSame(201);
        $poll = $this->getJson('/api/host-agent/remote-requests', self::auth($agent));
        self::assertResponseIsSuccessful();
        self::assertSame($created['id'], $poll['requests'][0]['id']);
        $other = $this->postJson('/api/devices/'.self::SECOND_DEVICE.'/remote-requests', ['offer' => 'v=0'], self::auth($controller));
        $this->putJson('/api/host-agent/remote-requests/'.$other['id'].'/answer', ['answer' => 'v=0'], self::auth($agent));
        self::assertResponseStatusCodeSame(404);
        $this->putJson('/api/host-agent/remote-requests/'.$created['id'].'/answer', ['answer' => 'v=0'], self::auth($agent));
        self::assertResponseStatusCodeSame(204);
        $answer = $this->getJson('/api/remote-requests/'.$created['id'], self::auth($controller));
        self::assertSame(['status' => 'answered', 'answer' => 'v=0'], $answer);
        $devices = $this->getJson('/api/devices', self::auth($host))['devices'];
        $byId = array_column($devices, null, 'id');
        self::assertSame('agent', $byId[self::DEVICE_ID]['remote']['mode']);
        self::assertTrue($byId[self::DEVICE_ID]['remote']['capabilities']['restart']);
        self::assertFalse($byId[self::DEVICE_ID]['remote']['capabilities']['login']);
        self::assertArrayNotHasKey('mode', $byId[self::SECOND_DEVICE]['remote']);
    }

    public function testLegacyHostCannotMutateAgentAndRevocationRestoresOwnership(): void
    {
        $agent = $this->agent($host);
        $this->putDevice($host);
        self::assertResponseStatusCodeSame(409);
        self::assertSame('device_agent_owned', $this->errorCode());
        $this->getJson('/api/devices/'.self::DEVICE_ID.'/remote-requests', self::deviceAuth($host));
        self::assertResponseStatusCodeSame(409);
        $this->deleteJson('/api/devices/'.self::DEVICE_ID, [], self::deviceAuth($host));
        self::assertResponseStatusCodeSame(409);
        $this->deleteJson('/api/devices/'.self::DEVICE_ID.'/agent', [], self::auth($host));
        self::assertResponseStatusCodeSame(204);
        $this->deleteJson('/api/devices/'.self::DEVICE_ID.'/agent', [], self::auth($host));
        self::assertResponseStatusCodeSame(204);
        self::assertSame('disabled', $this->db()->fetchOne('SELECT remote_state FROM device WHERE id = ?', [self::DEVICE_ID]));
        $this->putDevice($host);
        self::assertResponseIsSuccessful();
        $this->getJson('/api/host-agent/ice-servers', self::auth($agent));
        self::assertResponseStatusCodeSame(401);
    }

    public function testAgentCanRevokeItselfButNotAnotherDevice(): void
    {
        $agent = $this->agent($host);
        $this->putDevice($host, self::SECOND_DEVICE);
        $this->deleteJson('/api/devices/'.self::SECOND_DEVICE.'/agent', [], self::auth($agent));
        self::assertResponseStatusCodeSame(404);
        $this->deleteJson('/api/devices/'.self::DEVICE_ID.'/agent', [], self::auth($agent));
        self::assertResponseStatusCodeSame(204);
        $this->getJson('/api/host-agent/ice-servers', self::auth($agent));
        self::assertResponseStatusCodeSame(401);
    }

    #[DataProvider('revocationEvents')]
    public function testAccountEventsRevokeAgent(string $event): void
    {
        $agent = $this->agent($host);
        if ('logout' === $event) {
            $this->postJson('/api/auth/logout', [], self::auth($host));
            self::assertResponseStatusCodeSame(204);
        } elseif ('password' === $event) {
            $this->putJson('/api/me/password', ['currentPassword' => self::PASSWORD, 'newPassword' => 'otra-contraseña-de-prueba'], self::auth($host));
            self::assertResponseStatusCodeSame(204);
            $this->getJson('/api/me', self::auth($host));
            self::assertResponseIsSuccessful();
        } elseif ('reset' === $event) {
            $user = $this->em->getRepository(User::class)->findOneBy(['email' => 'ana@ejemplo.com']);
            static::getContainer()->get(AccountService::class)->resetPassword($user);
        } else {
            $this->deleteJson('/api/me', ['password' => self::PASSWORD], self::auth($host));
            self::assertResponseStatusCodeSame(204);
        }
        $this->getJson('/api/host-agent/ice-servers', self::auth($agent));
        self::assertResponseStatusCodeSame(401);
        self::assertSame(0, (int) $this->db()->fetchOne('SELECT COUNT(*) FROM host_agent'));
    }

    public static function revocationEvents(): iterable
    {
        foreach (['logout', 'password', 'reset', 'delete'] as $event) { yield $event => [$event]; }
    }

    public function testUnrelatedLogoutDoesNotRevokeAgent(): void
    {
        $agent = $this->agent();
        $other = $this->login();
        $this->postJson('/api/auth/logout', [], self::auth($other));
        self::assertResponseStatusCodeSame(204);
        $this->getJson('/api/host-agent/ice-servers', self::auth($agent));
        self::assertResponseIsSuccessful();
    }

    #[DataProvider('expirationSources')]
    public function testExpiredAgentOrOriginCannotBeRenewed(string $table): void
    {
        $agent = $this->agent();
        $past = (new \DateTimeImmutable('-1 second'))->format('Y-m-d H:i:s');
        $this->db()->executeStatement("UPDATE $table SET expires_at = ?", [$past]);
        $this->getJson('/api/host-agent/ice-servers', self::auth($agent));
        self::assertResponseStatusCodeSame(401);
        self::assertSame($past, $this->db()->fetchOne("SELECT expires_at FROM $table"));
    }

    public static function expirationSources(): iterable
    {
        yield 'agent' => ['host_agent'];
        yield 'origin' => ['user_session'];
    }

    public function testAgentInactivitySlidesWithoutTouchingOrigin(): void
    {
        $agent = $this->agent();
        $old = (new \DateTimeImmutable('-2 hours'))->format('Y-m-d H:i:s');
        $this->db()->executeStatement('UPDATE user_session SET last_used_at = ?', [$old]);
        $this->db()->executeStatement('UPDATE host_agent SET last_used_at = ?, expires_at = ?', [$old, (new \DateTimeImmutable('+1 day'))->format('Y-m-d H:i:s')]);
        $this->getJson('/api/host-agent/ice-servers', self::auth($agent));
        self::assertResponseIsSuccessful();
        self::assertGreaterThan(new \DateTimeImmutable('+89 days'), new \DateTimeImmutable($this->db()->fetchOne('SELECT expires_at FROM host_agent')));
        self::assertSame($old, $this->db()->fetchOne('SELECT last_used_at FROM user_session'));
    }

    public function testDisabledRemoteFeatureAlsoBlocksAgentAndPublicRedemption(): void
    {
        $agent = $this->agent();
        $saved = $_ENV['REMOTE_ENABLED'] ?? '1';
        try {
            $_ENV['REMOTE_ENABLED'] = $_SERVER['REMOTE_ENABLED'] = '0';
            $this->getJson('/api/host-agent/ice-servers', self::auth($agent));
            self::assertResponseStatusCodeSame(503);
            $this->postJson('/api/host-agent/enroll', self::AGENT_INFO);
            self::assertResponseStatusCodeSame(503);
            self::assertSame('remote_unavailable', $this->errorCode());
        } finally {
            $_ENV['REMOTE_ENABLED'] = $_SERVER['REMOTE_ENABLED'] = $saved;
        }
    }

    public function testAgentAndAccountShareTurnQuota(): void
    {
        $agent = $this->agent($host);
        for ($i = 0; $i < 120; ++$i) {
            $this->getJson($i % 2 ? '/api/host-agent/ice-servers' : '/api/remote/ice-servers', self::auth($i % 2 ? $agent : $host));
            self::assertResponseIsSuccessful();
        }
        $this->getJson('/api/host-agent/ice-servers', self::auth($agent));
        self::assertResponseStatusCodeSame(429);
    }

    public function testPendingEnrollmentDiesWithItsOrigin(): void
    {
        $host = $this->register()['token'];
        $this->putDevice($host);
        $enrollment = $this->enrollment($host);
        $this->postJson('/api/auth/logout', [], self::auth($host));
        self::assertResponseStatusCodeSame(204);
        $this->postJson('/api/host-agent/enroll', ['enrollmentToken' => $enrollment['enrollmentToken']] + self::AGENT_INFO);
        self::assertResponseStatusCodeSame(400);
        self::assertSame(0, (int) $this->db()->fetchOne('SELECT COUNT(*) FROM agent_enrollment'));
    }

    public function testExpiredOriginCannotRedeemPendingEnrollment(): void
    {
        $host = $this->register()['token'];
        $this->putDevice($host);
        $enrollment = $this->enrollment($host);
        $this->db()->executeStatement('UPDATE user_session SET expires_at = ?', [(new \DateTimeImmutable('-1 second'))->format('Y-m-d H:i:s')]);
        $this->postJson('/api/host-agent/enroll', ['enrollmentToken' => $enrollment['enrollmentToken']] + self::AGENT_INFO);
        self::assertResponseStatusCodeSame(400);
        self::assertSame(0, (int) $this->db()->fetchOne('SELECT COUNT(*) FROM host_agent'));
    }

    public function testHandoffClearsOnlyThatDevicesPendingRequestsAndRejectsLegacyAnswers(): void
    {
        $host = $this->register()['token'];
        $this->putDevice($host);
        $this->putDevice($host, self::SECOND_DEVICE);
        $controller = $this->login();
        $first = $this->postJson('/api/devices/'.self::DEVICE_ID.'/remote-requests', ['offer' => 'v=0'], self::auth($controller));
        $other = $this->postJson('/api/devices/'.self::SECOND_DEVICE.'/remote-requests', ['offer' => 'v=0'], self::auth($controller));
        $enrollment = $this->enrollment($host);
        $this->postJson('/api/host-agent/enroll', ['enrollmentToken' => $enrollment['enrollmentToken']] + self::AGENT_INFO);
        self::assertResponseStatusCodeSame(201);
        self::assertFalse($this->db()->fetchOne('SELECT id FROM remote_request WHERE id = ?', [$first['id']]));
        self::assertSame($other['id'], $this->db()->fetchOne('SELECT id FROM remote_request WHERE id = ?', [$other['id']]));
        $next = $this->postJson('/api/devices/'.self::DEVICE_ID.'/remote-requests', ['offer' => 'v=0'], self::auth($controller));
        $this->putJson('/api/remote-requests/'.$next['id'].'/answer', ['answer' => 'v=0'], self::deviceAuth($host));
        self::assertResponseStatusCodeSame(409);
        self::assertSame('device_agent_owned', $this->errorCode());
    }

    public function testAgentUsesTheExistingDevicePollLimiter(): void
    {
        $agent = $this->agent();
        $device = $this->em->find(\App\Entity\Device::class, \Symfony\Component\Uid\Uuid::fromString(self::DEVICE_ID));
        static::getContainer()->get(\App\Remote\RemoteLimiter::class)->poll($device);
        $this->getJson('/api/host-agent/remote-requests', self::auth($agent));
        self::assertResponseStatusCodeSame(429);
    }

    public function testForeignAccountCannotRevokeOrAnswerThroughAgent(): void
    {
        $agent = $this->agent($host);
        $foreign = $this->register('otra@ejemplo.com')['token'];
        $this->putDevice($foreign, self::SECOND_DEVICE);
        $created = $this->postJson('/api/devices/'.self::SECOND_DEVICE.'/remote-requests', ['offer' => 'v=0'], self::auth($foreign));
        $this->putJson('/api/host-agent/remote-requests/'.$created['id'].'/answer', ['answer' => 'v=0'], self::auth($agent));
        self::assertResponseStatusCodeSame(404);
        $this->deleteJson('/api/devices/'.self::DEVICE_ID.'/agent', [], self::auth($foreign));
        self::assertResponseStatusCodeSame(404);
        self::assertSame(1, (int) $this->db()->fetchOne('SELECT COUNT(*) FROM host_agent'));
    }

    public function testPublicRedemptionHasSharedIpLimit(): void
    {
        for ($i = 0; $i < 30; ++$i) {
            $this->postJson('/api/host-agent/enroll', ['enrollmentToken' => 'ace_'.str_repeat('x', 43)] + self::AGENT_INFO);
            self::assertResponseStatusCodeSame(400);
        }
        $this->postJson('/api/host-agent/enroll', self::AGENT_INFO);
        self::assertResponseStatusCodeSame(429);
        self::assertSame('too_many_requests', $this->errorCode());
        self::assertTrue($this->client->getResponse()->headers->has('Retry-After'));
    }

    public function testUpdateAndInvalidCapabilities(): void
    {
        $agent = $this->agent($host);
        $this->putJson('/api/host-agent/device', self::deviceInfo(['name' => 'Agente actualizado']) + self::AGENT_INFO, self::auth($agent));
        self::assertResponseIsSuccessful();
        $devices = $this->getJson('/api/devices', self::auth($host));
        self::assertSame('Agente actualizado', $devices['devices'][0]['name']);
        $this->putJson('/api/host-agent/device', self::deviceInfo() + ['agentVersion' => '0.1.0', 'capabilities' => ['shell' => true]], self::auth($agent));
        self::assertResponseStatusCodeSame(400);
        self::assertSame('agent_invalid', $this->errorCode());
    }
}
