<?php

namespace App\Tests\Api;

use App\Security\SessionManager;
use App\Tests\ApiTestCase;
use Symfony\Component\Uid\Uuid;

final class AgentEnrollmentTransactionTest extends ApiTestCase
{
    private const string FIRST = '12345678-1234-4abc-8def-123456789abc';
    private const string SECOND = '22345678-1234-4abc-8def-123456789abc';

    private function path(string $transaction = self::FIRST): string
    {
        return '/api/devices/'.self::DEVICE_ID.'/agent-enrollment-transactions/'.$transaction;
    }

    private function host(): string
    {
        $host = $this->register()['token'];
        $this->putDevice($host);

        return $host;
    }

    private function grant(string $host, string $transaction = self::FIRST): array
    {
        $result = $this->postJson($this->path($transaction), [], self::deviceAuth($host));
        self::assertResponseStatusCodeSame(201);
        self::assertSame($transaction, $result['transactionId']);

        return $result;
    }

    private function consume(array $grant): array
    {
        $agent = $this->postJson('/api/host-agent/enroll', ['enrollmentToken' => $grant['enrollmentToken'], 'agentVersion' => '0.1.0+tx', 'capabilities' => []]);
        self::assertResponseStatusCodeSame(201);
        self::assertSame($grant['transactionId'], $agent['transactionId']);

        return $agent;
    }

    public function testCancelBeforeCreateLeavesTombstoneAndBlocksDelayedPost(): void
    {
        $host = $this->host();
        self::assertSame(['state' => 'absent', 'legacyAllowed' => true], $this->getJson($this->path(), self::deviceAuth($host)));
        self::assertSame(['state' => 'cancelled', 'legacyAllowed' => true], $this->deleteJson($this->path(), [], self::deviceAuth($host)));
        self::assertResponseIsSuccessful();
        $this->postJson($this->path(), [], self::deviceAuth($host));
        self::assertResponseStatusCodeSame(409);
        self::assertSame('agent_enrollment_transaction_closed', $this->errorCode());
        self::assertSame(0, (int) $this->db()->fetchOne('SELECT COUNT(*) FROM agent_enrollment'));
        self::assertSame(['state' => 'cancelled', 'legacyAllowed' => true], $this->deleteJson($this->path(), [], self::deviceAuth($host)));
        self::assertSame(1, (int) $this->db()->fetchOne('SELECT COUNT(*) FROM agent_enrollment_transaction'));
    }

    public function testDuplicateCannotReissueSecretAndStatusContainsOnlyPublicState(): void
    {
        $host = $this->host();
        $grant = $this->grant($host);
        self::assertSame(hash('sha256', $grant['enrollmentToken']), $this->db()->fetchOne('SELECT token_hash FROM agent_enrollment'));
        self::assertSame(['state' => 'pending', 'legacyAllowed' => false], $this->getJson($this->path(), self::deviceAuth($host)));
        $this->postJson($this->path(), [], self::deviceAuth($host));
        self::assertResponseStatusCodeSame(409);
        self::assertSame('agent_enrollment_transaction_exists', $this->errorCode());
        $agent = $this->consume($grant);
        self::assertSame(['state' => 'consumed', 'legacyAllowed' => false], $this->getJson($this->path(), self::deviceAuth($host)));
        $this->getJson('/api/host-agent/remote-requests', self::auth($agent['token']));
        self::assertResponseIsSuccessful();
        self::assertSame(0, (int) $this->db()->fetchOne('SELECT COUNT(*) FROM agent_enrollment'));
    }

    public function testScopedCompensationAfterConsumeInvalidatesOnlyItsCredential(): void
    {
        $host = $this->host();
        $agent = $this->consume($this->grant($host));
        self::assertSame(['state' => 'cancelled', 'legacyAllowed' => true], $this->deleteJson($this->path(), [], self::deviceAuth($host)));
        self::assertResponseIsSuccessful();
        $this->getJson('/api/host-agent/remote-requests', self::auth($agent['token']));
        self::assertResponseStatusCodeSame(401);
        self::assertSame('disabled', $this->db()->fetchOne('SELECT remote_state FROM device'));
        $this->putDevice($host);
        self::assertResponseIsSuccessful();
    }

    public function testOlderCompensationPreservesNewerAgentAndItsPendingRequest(): void
    {
        $host = $this->host();
        $this->consume($this->grant($host));
        $this->deleteJson('/api/devices/'.self::DEVICE_ID.'/agent', [], self::auth($host));
        self::assertResponseStatusCodeSame(204);
        $agent = $this->consume($this->grant($host, self::SECOND));
        $this->putJson('/api/host-agent/device', self::deviceInfo() + ['agentVersion' => '0.1.0+tx', 'capabilities' => []], self::auth($agent['token']));
        self::assertResponseIsSuccessful();
        $pending = $this->postJson('/api/devices/'.self::DEVICE_ID.'/remote-requests', ['offer' => 'v=0 pending'], self::auth($host));
        self::assertResponseStatusCodeSame(201);
        $entries = [
            ['id' => 'ssh-preserved', 'name' => 'SSH ficticio', 'type' => 'ssh', 'host' => 'example.invalid', 'port' => 22, 'username' => 'lab', 'authMethod' => 'password', 'password' => 'fictitious-ssh-secret'],
            ['id' => 's3-preserved', 'name' => 'S3 ficticio', 'type' => 's3', 'endpoint' => 'https://s3.example.invalid', 'accessKeyId' => 'fictitious-access', 'secretAccessKey' => 'fictitious-s3-secret'],
        ];
        $this->putJson('/api/connections', ['revision' => 0, 'entries' => $entries], self::auth($host));
        self::assertResponseIsSuccessful();
        $connections = $this->getJson('/api/connections', self::auth($host));
        self::assertSame(['state' => 'cancelled', 'legacyAllowed' => false], $this->deleteJson($this->path(), [], self::deviceAuth($host)));
        self::assertSame(self::SECOND, $this->db()->fetchOne('SELECT transaction_id FROM host_agent'));
        $requests = $this->getJson('/api/host-agent/remote-requests', self::auth($agent['token']));
        self::assertResponseIsSuccessful();
        self::assertSame($pending['id'], $requests['requests'][0]['id']);
        self::assertSame($connections, $this->getJson('/api/connections', self::auth($host)));
    }

    public function testOldCompensationDoesNotDeleteNewerUnconsumedGrant(): void
    {
        $host = $this->host();
        $first = $this->grant($host);
        $second = $this->grant($host, self::SECOND);
        self::assertSame(['state' => 'cancelled', 'legacyAllowed' => false], $this->deleteJson($this->path(), [], self::deviceAuth($host)));
        $this->postJson('/api/host-agent/enroll', ['enrollmentToken' => $first['enrollmentToken'], 'agentVersion' => '0.1.0', 'capabilities' => []]);
        self::assertResponseStatusCodeSame(400);
        $this->consume($second);
    }

    public function testDifferentSessionCannotAdoptOrCancelAnIntentEvenWithDeviceKey(): void
    {
        $host = $this->host();
        $grant = $this->grant($host);
        $otherSession = $this->login();
        foreach (['GET', 'DELETE', 'POST'] as $method) {
            $this->client->request($method, $this->path(), server: ['HTTP_AUTHORIZATION' => 'Bearer '.$otherSession, 'HTTP_X_DEVICE_KEY' => self::DEVICE_KEY]);
            self::assertResponseStatusCodeSame(404);
            self::assertSame('agent_enrollment_transaction_not_found', $this->errorCode());
        }
        $this->consume($grant);
    }

    public function testWrongOwnerKeyAndAgentCredentialsCannotTouchTransactions(): void
    {
        $host = $this->host();
        $grant = $this->grant($host);
        $other = $this->register('otra@ejemplo.com')['token'];
        foreach (['GET', 'DELETE', 'POST'] as $method) {
            $this->client->request($method, $this->path(), server: ['HTTP_AUTHORIZATION' => 'Bearer '.$other, 'HTTP_X_DEVICE_KEY' => self::DEVICE_KEY]);
            self::assertResponseStatusCodeSame(404);
            $this->client->request($method, $this->path(), server: ['HTTP_AUTHORIZATION' => 'Bearer '.$host, 'HTTP_X_DEVICE_KEY' => str_repeat('x', 40)]);
            self::assertResponseStatusCodeSame(403);
        }
        $agent = $this->consume($grant);
        foreach (['GET', 'DELETE', 'POST'] as $method) {
            $this->client->request($method, $this->path(), server: ['HTTP_AUTHORIZATION' => 'Bearer '.$agent['token'], 'HTTP_X_DEVICE_KEY' => self::DEVICE_KEY]);
            self::assertResponseStatusCodeSame(401);
        }
        self::assertSame('consumed', $this->db()->fetchOne('SELECT state FROM agent_enrollment_transaction'));
    }

    public function testQuotaDoesNotDiscardTombstonesAndSessionDeletionCascadesThem(): void
    {
        $host = $this->host();
        $source = $this->db()->fetchOne('SELECT id FROM user_session WHERE token_hash = ?', [SessionManager::hash($host)]);
        $now = (new \DateTimeImmutable())->format('Y-m-d H:i:s');
        for ($i = 0; $i < 64; ++$i) {
            $this->db()->insert('agent_enrollment_transaction', ['device_id' => self::DEVICE_ID, 'transaction_id' => Uuid::v4()->toRfc4122(), 'source_session_id' => $source, 'state' => 'cancelled', 'created_at' => $now, 'updated_at' => $now]);
        }
        $this->postJson($this->path(), [], self::deviceAuth($host));
        self::assertResponseStatusCodeSame(409);
        self::assertSame('agent_enrollment_transaction_limit', $this->errorCode());
        $this->deleteJson($this->path(), [], self::deviceAuth($host));
        self::assertResponseStatusCodeSame(409);
        self::assertSame(64, (int) $this->db()->fetchOne('SELECT COUNT(*) FROM agent_enrollment_transaction'));
        $this->postJson('/api/auth/logout', [], self::auth($host));
        self::assertResponseIsSuccessful();
        self::assertSame(0, (int) $this->db()->fetchOne('SELECT COUNT(*) FROM agent_enrollment_transaction'));
    }

    public function testLegacyEnrollmentStillWorksAndCannotBeCancelledByAnOlderTransaction(): void
    {
        $host = $this->host();
        $this->grant($host);
        $legacy = $this->postJson('/api/devices/'.self::DEVICE_ID.'/agent-enrollments', [], self::deviceAuth($host));
        self::assertResponseStatusCodeSame(201);
        self::assertArrayNotHasKey('transactionId', $legacy);
        self::assertSame(['state' => 'cancelled', 'legacyAllowed' => false], $this->deleteJson($this->path(), [], self::deviceAuth($host)));
        $result = $this->postJson('/api/host-agent/enroll', ['enrollmentToken' => $legacy['enrollmentToken'], 'agentVersion' => '0.1.0', 'capabilities' => []]);
        self::assertResponseStatusCodeSame(201);
        self::assertArrayNotHasKey('transactionId', $result);
    }
}
