<?php

namespace App\HostAgent;

use App\Api\ApiException;
use App\Entity\Device;
use App\Entity\User;
use App\Entity\UserSession;
use App\Remote\DeviceKey;
use Doctrine\DBAL\Connection;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\Uid\Uuid;

/**
 * Altas y credenciales opacas. SQL explícito para serializar canje, baja y traspaso
 * entre réplicas. El uso del agente no toca la caducidad de la sesión de origen.
 */
final class AgentRegistry
{
    public const int LEASE_SECONDS = 30;

    public function __construct(private readonly Connection $db, private readonly EntityManagerInterface $em)
    {
    }

    public function createEnrollment(User $user, UserSession $source, Uuid $id, #[\SensitiveParameter] string $key, ?Uuid $transaction = null): array
    {
        return $this->db->transactional(function () use ($user, $source, $id, $key, $transaction): array {
            $now = new \DateTimeImmutable();
            $this->lockSource($source->getId()->toRfc4122(), $now);
            $device = $this->lockDevice($id);
            if (!$device->getUser()->getId()->equals($user->getId())) {
                throw new ApiException('device_not_found', 404);
            }
            if (!hash_equals($device->getKeyHash(), DeviceKey::hash($key))) {
                throw new ApiException('device_key_invalid', 403);
            }
            if (null !== $transaction && false !== ($existing = $this->transactionRow($id, $transaction))) {
                $this->assertTransactionSource($existing, $source);
                throw new ApiException('cancelled' === $existing['state'] ? 'agent_enrollment_transaction_closed' : 'agent_enrollment_transaction_exists', 409);
            }
            $this->assertLegacy($device);
            if (null !== $transaction) {
                $this->assertTransactionCapacity($id, $source);
            }
            $this->db->executeStatement("UPDATE agent_enrollment_transaction SET state = 'cancelled', updated_at = ? WHERE device_id = ? AND state = 'pending'", [self::date($now), $id->toRfc4122()]);
            $this->db->delete('agent_enrollment', ['device_id' => $id->toRfc4122()]);
            if (null !== $transaction) {
                $this->insertTransaction($id, $source, $transaction, 'pending', $now);
            }
            $token = self::token('ace_');
            $expires = $now->modify('+5 minutes');
            $this->db->insert('agent_enrollment', [
                'id' => Uuid::v7()->toRfc4122(), 'device_id' => $id->toRfc4122(),
                'source_session_id' => $source->getId()->toRfc4122(),
                'token_hash' => hash('sha256', $token), 'expires_at' => self::date($expires),
                'transaction_id' => $transaction?->toRfc4122(),
            ]);

            $result = ['enrollmentToken' => $token, 'expiresAt' => $expires->format(\DateTimeInterface::ATOM)];

            return null === $transaction ? $result : $result + ['transactionId' => $transaction->toRfc4122()];
        });
    }

    public function enroll(#[\SensitiveParameter] mixed $token, AgentInfo $info): array
    {
        if (!\is_string($token) || !preg_match('/^ace_[A-Za-z0-9_-]{43}$/D', $token)) {
            throw new ApiException('agent_enrollment_invalid', 400);
        }
        return $this->db->transactional(function () use ($token, $info): array {
            $hash = hash('sha256', $token);
            $enrollment = $this->db->fetchAssociative('SELECT * FROM agent_enrollment WHERE token_hash = ?', [$hash]);
            if (false === $enrollment) {
                throw new ApiException('agent_enrollment_invalid', 400);
            }
            // Orden de bloqueo compartido con logout: sesión y después equipo.
            $this->lockSource($enrollment['source_session_id'], new \DateTimeImmutable());
            $device = $this->lockDevice(Uuid::fromString($enrollment['device_id']));
            $now = new \DateTimeImmutable();
            $enrollment = $this->db->fetchAssociative('SELECT * FROM agent_enrollment WHERE token_hash = ? AND expires_at > ?', [$hash, self::date($now)]);
            if (false === $enrollment) {
                throw new ApiException('agent_enrollment_invalid', 400);
            }
            $this->assertLegacy($device);
            if (null !== $enrollment['transaction_id']) {
                $intent = $this->transactionRow($device->getId(), Uuid::fromString($enrollment['transaction_id']));
                if (false === $intent || 'pending' !== $intent['state'] || $intent['source_session_id'] !== $enrollment['source_session_id']) {
                    throw new ApiException('agent_enrollment_invalid', 400);
                }
                $this->db->update('agent_enrollment_transaction', ['state' => 'consumed', 'updated_at' => self::date($now)], ['device_id' => $enrollment['device_id'], 'transaction_id' => $enrollment['transaction_id']]);
            }
            $credential = self::token('acg_');
            $expires = $now->modify('+90 days');
            $this->db->insert('host_agent', [
                'device_id' => $device->getId()->toRfc4122(),
                'source_session_id' => $enrollment['source_session_id'],
                'transaction_id' => $enrollment['transaction_id'],
                'token_hash' => hash('sha256', $credential),
                'agent_version' => $info->version, 'capabilities' => json_encode($info->capabilities, JSON_THROW_ON_ERROR),
                'created_at' => self::date($now), 'last_used_at' => self::date($now), 'expires_at' => self::date($expires),
            ]);
            $this->db->delete('agent_enrollment', ['device_id' => $device->getId()->toRfc4122()]);
            // Una oferta recogida por la interfaz anterior no se entrega al nuevo trabajador.
            $this->db->delete('remote_request', ['device_id' => $device->getId()->toRfc4122()]);

            $result = ['token' => $credential, 'deviceId' => $device->getId()->toRfc4122(),
                'expiresAt' => $expires->format(\DateTimeInterface::ATOM)];

            return null === $enrollment['transaction_id'] ? $result : $result + ['transactionId' => $enrollment['transaction_id']];
        });
    }

    /** Consulta sin secretos; ausencia no equivale a una compensación ya completada. */
    public function transactionStatus(User $user, UserSession $source, Uuid $id, #[\SensitiveParameter] string $key, Uuid $transaction): array
    {
        return $this->db->transactional(function () use ($user, $source, $id, $key, $transaction): array {
            $now = new \DateTimeImmutable();
            $this->transactionDevice($user, $source, $id, $key, $now);
            $row = $this->transactionRow($id, $transaction);
            if (false === $row) {
                $state = 'absent';
            } else {
                $this->assertTransactionSource($row, $source);
                $state = $row['state'];
                if ('pending' === $state && !$this->db->fetchOne('SELECT 1 FROM agent_enrollment WHERE device_id = ? AND transaction_id = ? AND expires_at > ?', [$id->toRfc4122(), $transaction->toRfc4122(), self::date($now)])) {
                    $state = 'expired';
                }
                if ('consumed' === $state && !$this->db->fetchOne('SELECT 1 FROM host_agent WHERE device_id = ? AND transaction_id = ?', [$id->toRfc4122(), $transaction->toRfc4122()])) {
                    $state = 'retired';
                }
            }

            return ['state' => $state, 'legacyAllowed' => $this->legacyAllowed($id, $now)];
        });
    }

    /** La lápida impide crear después del DELETE; nunca retira otro canje del mismo equipo. */
    public function cancelTransaction(User $user, UserSession $source, Uuid $id, #[\SensitiveParameter] string $key, Uuid $transaction): array
    {
        return $this->db->transactional(function () use ($user, $source, $id, $key, $transaction): array {
            $now = new \DateTimeImmutable();
            $this->transactionDevice($user, $source, $id, $key, $now);
            $row = $this->transactionRow($id, $transaction);
            if (false === $row) {
                $this->assertTransactionCapacity($id, $source);
                $this->insertTransaction($id, $source, $transaction, 'cancelled', $now);
            } else {
                $this->assertTransactionSource($row, $source);
                $this->db->update('agent_enrollment_transaction', ['state' => 'cancelled', 'updated_at' => self::date($now)], ['device_id' => $id->toRfc4122(), 'transaction_id' => $transaction->toRfc4122()]);
            }
            $scope = ['device_id' => $id->toRfc4122(), 'transaction_id' => $transaction->toRfc4122(), 'source_session_id' => $source->getId()->toRfc4122()];
            $this->db->delete('agent_enrollment', $scope);
            if ($this->db->delete('host_agent', $scope)) {
                $this->db->update('device', ['remote_state' => 'disabled'], ['id' => $id->toRfc4122()]);
                $this->db->delete('remote_request', ['device_id' => $id->toRfc4122()]);
            }

            return ['state' => 'cancelled', 'legacyAllowed' => $this->legacyAllowed($id, $now)];
        });
    }

    private function transactionDevice(User $user, UserSession $source, Uuid $id, #[\SensitiveParameter] string $key, \DateTimeImmutable $now): Device
    {
        $this->lockSource($source->getId()->toRfc4122(), $now);
        $device = $this->lockDevice($id);
        if (!$device->getUser()->getId()->equals($user->getId())) {
            throw new ApiException('device_not_found', 404);
        }
        if (!hash_equals($device->getKeyHash(), DeviceKey::hash($key))) {
            throw new ApiException('device_key_invalid', 403);
        }

        return $device;
    }

    private function transactionRow(Uuid $id, Uuid $transaction): array|false
    {
        return $this->db->fetchAssociative('SELECT * FROM agent_enrollment_transaction WHERE device_id = ? AND transaction_id = ?', [$id->toRfc4122(), $transaction->toRfc4122()]);
    }

    private function assertTransactionSource(array $row, UserSession $source): void
    {
        if ($row['source_session_id'] !== $source->getId()->toRfc4122()) {
            throw new ApiException('agent_enrollment_transaction_not_found', 404);
        }
    }

    private function assertTransactionCapacity(Uuid $id, UserSession $source): void
    {
        if ((int) $this->db->fetchOne('SELECT COUNT(*) FROM agent_enrollment_transaction WHERE device_id = ? AND source_session_id = ?', [$id->toRfc4122(), $source->getId()->toRfc4122()]) >= 64) {
            throw new ApiException('agent_enrollment_transaction_limit', 409);
        }
    }

    private function insertTransaction(Uuid $id, UserSession $source, Uuid $transaction, string $state, \DateTimeImmutable $now): void
    {
        $this->db->insert('agent_enrollment_transaction', ['device_id' => $id->toRfc4122(), 'transaction_id' => $transaction->toRfc4122(), 'source_session_id' => $source->getId()->toRfc4122(), 'state' => $state, 'created_at' => self::date($now), 'updated_at' => self::date($now)]);
    }

    private function legacyAllowed(Uuid $id, \DateTimeImmutable $now): bool
    {
        return !$this->db->fetchOne('SELECT 1 FROM host_agent WHERE device_id = ?', [$id->toRfc4122()])
            && !$this->db->fetchOne('SELECT 1 FROM agent_enrollment WHERE device_id = ? AND expires_at > ?', [$id->toRfc4122(), self::date($now)]);
    }

    public function authenticate(#[\SensitiveParameter] string $token): ?AgentPrincipal
    {
        if (!preg_match('/^acg_[A-Za-z0-9_-]{43}$/D', $token)) {
            return null;
        }
        $hash = hash('sha256', $token);
        $row = $this->active($hash, new \DateTimeImmutable());
        if (false === $row) {
            return null;
        }
        $device = $this->em->find(Device::class, Uuid::fromString($row['device_id']));

        return null === $device ? null : new AgentPrincipal($device, $hash);
    }

    /** Cada operación revalida bajo el bloqueo de propietario, incluido el heartbeat. */
    public function operation(AgentPrincipal $agent, callable $action): mixed
    {
        return $this->db->transactional(function () use ($agent, $action): mixed {
            $device = $this->lockDevice($agent->device->getId());
            $now = new \DateTimeImmutable();
            $row = $this->active($agent->tokenHash, $now);
            if (false === $row || $row['device_id'] !== $device->getId()->toRfc4122()) {
                throw new ApiException('unauthenticated', 401);
            }
            // No renueva user_session. Una baja concurrente no puede recrear la credencial.
            if ($now->getTimestamp() - (new \DateTimeImmutable($row['last_used_at']))->getTimestamp() >= 3600) {
                $this->db->update('host_agent', ['last_used_at' => self::date($now), 'expires_at' => self::date($now->modify('+90 days'))], ['token_hash' => $agent->tokenHash]);
            }

            return $action($device, $now);
        });
    }

    public function updateInfo(Device $device, AgentInfo $info): void
    {
        $this->db->update('host_agent', ['agent_version' => $info->version,
            'capabilities' => json_encode($info->capabilities, JSON_THROW_ON_ERROR)], ['device_id' => $device->getId()->toRfc4122()]);
    }

    public function metadata(Device $device): array
    {
        $row = $this->db->fetchAssociative('SELECT agent_version, capabilities FROM host_agent WHERE device_id = ?', [$device->getId()->toRfc4122()]);

        return false === $row ? [] : ['mode' => 'agent', 'agentVersion' => $row['agent_version'],
            'capabilities' => json_decode($row['capabilities'], true, 16, JSON_THROW_ON_ERROR)];
    }

    public function assertLegacy(Device $device): void
    {
        if ($this->db->fetchOne('SELECT 1 FROM host_agent WHERE device_id = ?', [$device->getId()->toRfc4122()])) {
            throw new ApiException('device_agent_owned', 409);
        }
    }

    public function revoke(Device $device): void
    {
        $this->db->transactional(function () use ($device): void {
            $this->lockDevice($device->getId());
            $this->retire($device->getId()->toRfc4122());
        });
    }

    /** Debe ejecutarse en la misma transacción que invalida/borra las sesiones. */
    public function revokeSources(User $user, ?UserSession $keep = null, ?\DateTimeImmutable $expired = null): void
    {
        $where = 'user_id = ?';
        $params = [$user->getId()->toRfc4122()];
        if (null !== $keep) {
            $where .= ' AND id <> ?';
            $params[] = $keep->getId()->toRfc4122();
        }
        if (null !== $expired) {
            $where .= ' AND expires_at <= ?';
            $params[] = self::date($expired);
        }
        $sources = $this->db->fetchFirstColumn('SELECT id FROM user_session WHERE '.$where.' ORDER BY id FOR UPDATE', $params);
        foreach ($sources as $source) {
            $this->revokeSource($source);
        }
    }

    public function revokeSource(string $source): void
    {
        // El llamador ya bloqueó la sesión. Orden estable entre equipos de la cuenta.
        $devices = $this->db->fetchFirstColumn('SELECT d.id FROM device d JOIN host_agent a ON a.device_id = d.id WHERE a.source_session_id = ? ORDER BY d.id FOR UPDATE OF d', [$source]);
        foreach ($devices as $id) {
            $this->retire($id);
        }
        $this->db->delete('agent_enrollment', ['source_session_id' => $source]);
        $this->db->executeStatement("UPDATE agent_enrollment_transaction SET state = 'cancelled', updated_at = ? WHERE source_session_id = ?", [self::date(new \DateTimeImmutable()), $source]);
    }

    private function retire(string $id): void
    {
        $removed = $this->db->delete('host_agent', ['device_id' => $id]);
        $this->db->delete('agent_enrollment', ['device_id' => $id]);
        $this->db->executeStatement("UPDATE agent_enrollment_transaction SET state = 'cancelled', updated_at = ? WHERE device_id = ?", [self::date(new \DateTimeImmutable()), $id]);
        if ($removed) {
            $this->db->update('device', ['remote_state' => 'disabled'], ['id' => $id]);
            $this->db->delete('remote_request', ['device_id' => $id]);
        }
    }

    private function active(string $hash, \DateTimeImmutable $now): array|false
    {
        return $this->db->fetchAssociative('SELECT a.* FROM host_agent a JOIN user_session s ON s.id = a.source_session_id JOIN device d ON d.id = a.device_id WHERE a.token_hash = ? AND a.expires_at > ? AND s.expires_at > ? AND s.user_id = d.user_id', [$hash, self::date($now), self::date($now)]);
    }

    private function lockSource(string $id, \DateTimeImmutable $now): void
    {
        if (!$this->db->fetchOne('SELECT id FROM user_session WHERE id = ? AND expires_at > ? FOR SHARE', [$id, self::date($now)])) {
            throw new ApiException('agent_enrollment_invalid', 400);
        }
    }

    private function lockDevice(Uuid $id): Device
    {
        if (!$this->db->fetchOne('SELECT id FROM device WHERE id = ? FOR UPDATE', [$id->toRfc4122()])) {
            throw new ApiException('device_not_found', 404);
        }
        $device = $this->em->find(Device::class, $id);
        $this->em->refresh($device);

        return $device;
    }

    private static function token(string $prefix): string
    {
        return $prefix.rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
    }

    private static function date(\DateTimeImmutable $date): string
    {
        return $date->format('Y-m-d H:i:s');
    }
}
