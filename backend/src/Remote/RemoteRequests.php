<?php

namespace App\Remote;

use App\Api\ApiException;
use App\Entity\Device;
use App\Entity\RemoteRequest;
use App\Entity\User;
use App\Entity\UserSession;
use App\Repository\RemoteRequestRepository;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\Uid\Uuid;
use Symfony\Component\Uid\UuidV7;

/**
 * Negociación de las sesiones de control remoto por la API (add-remote-desktop D3-D5): el
 * controlador deja su oferta, el equipo la recoge al consultar y deja su respuesta o su rechazo.
 */
final class RemoteRequests
{
    /** Motivos con los que el equipo puede rechazar una solicitud (D5). */
    public const array REJECTION_REASONS = ['wrong_password', 'locked', 'busy', 'missing_permissions', 'remote_disabled', 'declined', 'unsupported'];

    public function __construct(
        private readonly EntityManagerInterface $em,
        private readonly RemoteRequestRepository $requests,
    ) {
    }

    public function create(Device $device, UserSession $controller, mixed $offer): RemoteRequest
    {
        $now = new \DateTimeImmutable();
        $offer = self::description($offer, 'offer');
        if (!$device->getRemoteState()->acceptsRequests()) {
            throw new ApiException('remote_disabled', 409);
        }
        if (!$device->isOnline($now)) {
            throw new ApiException('device_offline', 409);
        }

        $this->requests->deleteExpired($now);
        $request = new RemoteRequest($device, $controller, $offer, $now);
        $this->em->persist($request);
        $this->em->flush();

        return $request;
    }

    /**
     * Solicitudes que el equipo aún no ha respondido. Aprovecha para borrar las caducadas: así
     * solo quedan datos de negociación de solicitudes vivas, sin necesidad de un CronJob.
     *
     * @return list<RemoteRequest>
     */
    public function pendingFor(Device $device, \DateTimeImmutable $now): array
    {
        $this->requests->deleteExpired($now);

        return $this->requests->findPendingForDevice($device, $now);
    }

    /** Respuesta del equipo: `{answer}` o `{rejected: {reason, retryAfter?}}`, con su clave. */
    public function answer(User $user, Uuid $id, #[\SensitiveParameter] string $deviceKey, array $data): void
    {
        $request = $this->find($user, $id, new \DateTimeImmutable());
        if (!hash_equals($request->getDevice()->getKeyHash(), DeviceKey::hash($deviceKey))) {
            throw new ApiException('device_key_invalid', 403);
        }
        if (!$request->isPending()) {
            throw new ApiException('remote_request_answered', 409);
        }

        if (\array_key_exists('rejected', $data)) {
            $rejected = $data['rejected'];
            $reason = \is_array($rejected) ? ($rejected['reason'] ?? null) : null;
            $retryAfter = \is_array($rejected) ? ($rejected['retryAfter'] ?? null) : null;
            if (!\in_array($reason, self::REJECTION_REASONS, true)) {
                throw new ApiException('remote_request_invalid', 400, ['field' => 'rejected.reason']);
            }
            if (null !== $retryAfter && (!\is_int($retryAfter) || $retryAfter < 1 || $retryAfter > 86400)) {
                throw new ApiException('remote_request_invalid', 400, ['field' => 'rejected.retryAfter']);
            }
            $request->reject($reason, $retryAfter);
        } else {
            $request->answer(self::description($data['answer'] ?? null, 'answer'));
        }
        $this->em->flush();
    }

    /** Estado de la solicitud, solo para la sesión que la creó. */
    public function forController(User $user, UserSession $controller, Uuid $id): RemoteRequest
    {
        $request = $this->find($user, $id, new \DateTimeImmutable());
        if (!$request->getControllerSession()->getId()->equals($controller->getId())) {
            throw new ApiException('remote_request_not_found', 404);
        }

        return $request;
    }

    private function find(User $user, Uuid $id, \DateTimeImmutable $now): RemoteRequest
    {
        $request = $this->requests->findOneForUser($user, $id);
        if (null !== $request && !$request->isExpired($now)) {
            return $request;
        }
        // Las caducadas se borran, pero su identificador (UUIDv7) lleva la hora de creación: así
        // una consulta tardía recibe "caducada" y no "no existe"
        $created = $id instanceof UuidV7 ? $id->getDateTime() : null;
        if (null !== $request || (null !== $created && $created <= $now->modify('-'.RemoteRequest::LIFETIME_SECONDS.' seconds'))) {
            throw new ApiException('remote_request_expired', 410);
        }

        throw new ApiException('remote_request_not_found', 404);
    }

    private static function description(mixed $value, string $field): string
    {
        if (!\is_string($value) || '' === $value || \strlen($value) > RemoteRequest::MAX_DESCRIPTION_BYTES) {
            throw new ApiException('remote_request_invalid', 400, ['field' => $field]);
        }

        return $value;
    }
}
