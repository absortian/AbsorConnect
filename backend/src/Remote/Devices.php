<?php

namespace App\Remote;

use App\Api\ApiException;
use App\Entity\Device;
use App\Entity\User;
use App\HostAgent\AgentRegistry;
use App\Repository\DeviceRepository;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\Uid\Uuid;

/** Equipos de cada cuenta (add-remote-desktop D4, spec remote-signaling). */
final class Devices
{
    /** Los equipos sin contacto en este tiempo desaparecen (como las sesiones). */
    private const string FORGET_AFTER = '-90 days';
    /** El equipo consulta cada 3 s: basta con anotar su señal de vida cada 10 s. */
    private const int HEARTBEAT_INTERVAL_SECONDS = 10;

    public function __construct(
        private readonly EntityManagerInterface $em,
        private readonly DeviceRepository $devices,
        private readonly AgentRegistry $agents,
    ) {
    }

    /** @return list<Device> */
    public function list(User $user): array
    {
        return $this->devices->findForUser($user);
    }

    /** Alta o actualización del equipo que hace la petición, identificado por su clave. */
    public function register(User $user, Uuid $id, #[\SensitiveParameter] string $key, DeviceInfo $info): Device
    {
        return $this->em->getConnection()->transactional(function () use ($user, $id, $key, $info): Device {
            $now = new \DateTimeImmutable();
            // Limpieza al registrar: así no hace falta un CronJob para los equipos olvidados
            $this->devices->deleteNotSeenSince($now->modify(self::FORGET_AFTER));

            $this->em->getConnection()->fetchOne('SELECT id FROM device WHERE id = ? FOR UPDATE', [$id->toRfc4122()]);
            $device = $this->devices->findById($id);
            if (null !== $device) {
                $this->em->refresh($device);
            }
            if (null === $device) {
                $device = new Device($id, $user, DeviceKey::hash($key), $info, $now);
                $this->em->persist($device);
            } elseif (!$device->getUser()->getId()->equals($user->getId())) {
                throw new ApiException('device_taken', 409);
            } else {
                self::checkKey($device, $key);
                $this->agents->assertLegacy($device);
                $device->update($info, $now);
            }
            $this->em->flush();

            return $device;
        });
    }

    /** Equipo de la cuenta. Uno de otra cuenta responde igual que uno inexistente. */
    public function ofUser(User $user, Uuid $id): Device
    {
        $device = $this->devices->findById($id);
        if (null === $device || !$device->getUser()->getId()->equals($user->getId())) {
            throw new ApiException('device_not_found', 404);
        }

        return $device;
    }

    /** Equipo de la cuenta que opera sobre sí mismo: además exige su clave. */
    public function own(User $user, Uuid $id, #[\SensitiveParameter] string $key): Device
    {
        $device = $this->ofUser($user, $id);
        self::checkKey($device, $key);
        $this->agents->assertLegacy($device);

        return $device;
    }

    /** Impide que el host legado actúe durante un traspaso concurrente al agente. */
    public function legacyOperation(User $user, Uuid $id, string $key, callable $action): mixed
    {
        return $this->em->getConnection()->transactional(function () use ($user, $id, $key, $action): mixed {
            $this->em->getConnection()->fetchOne('SELECT id FROM device WHERE id = ? FOR UPDATE', [$id->toRfc4122()]);
            $device = $this->devices->findById($id);
            if (null !== $device) {
                $this->em->refresh($device);
            }
            $device = $this->own($user, $id, $key);

            return $action($device);
        });
    }

    public function remove(Device $device): void
    {
        $this->em->remove($device);
        $this->em->flush();
    }

    /** Señal de vida del equipo: lo mantiene en línea. */
    public function heartbeat(Device $device, \DateTimeImmutable $now): void
    {
        if ($now->getTimestamp() - $device->getLastSeenAt()->getTimestamp() < self::HEARTBEAT_INTERVAL_SECONDS) {
            return;
        }
        $device->touch($now);
        $this->em->flush();
    }

    private static function checkKey(Device $device, #[\SensitiveParameter] string $key): void
    {
        if (!hash_equals($device->getKeyHash(), DeviceKey::hash($key))) {
            throw new ApiException('device_key_invalid', 403);
        }
    }
}
