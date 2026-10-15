<?php

namespace App\Controller;

use App\Api\JsonBody;
use App\Entity\Device;
use App\Entity\RemoteRequest;
use App\Entity\User;
use App\Remote\DeviceInfo;
use App\Remote\DeviceKey;
use App\Remote\Devices;
use App\Remote\RemoteLimiter;
use App\Remote\RemoteRequests;
use App\Security\SessionManager;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Routing\Requirement\Requirement;
use Symfony\Component\Security\Http\Attribute\CurrentUser;
use Symfony\Component\Uid\Uuid;

/** Equipos de la cuenta para el control remoto (add-remote-desktop D5). */
#[Route('/api/devices')]
final class DevicesController extends AbstractController
{
    public function __construct(
        private readonly Devices $devices,
        private readonly RemoteRequests $requests,
        private readonly RemoteLimiter $limiter,
        private readonly SessionManager $sessions,
    ) {
    }

    #[Route('', methods: ['GET'])]
    public function list(#[CurrentUser] User $user): JsonResponse
    {
        $now = new \DateTimeImmutable();

        return new JsonResponse([
            'devices' => array_map(static fn (Device $device) => self::present($device, $now), $this->devices->list($user)),
        ]);
    }

    /** Alta o actualización del equipo que llama (con su clave en X-Device-Key). */
    #[Route('/{id}', methods: ['PUT'], requirements: ['id' => Requirement::UUID])]
    public function register(Uuid $id, Request $request, #[CurrentUser] User $user): JsonResponse
    {
        $key = DeviceKey::fromRequest($request);
        $device = $this->devices->register($user, $id, $key, DeviceInfo::fromJson(JsonBody::from($request)));

        return new JsonResponse(self::present($device, new \DateTimeImmutable()));
    }

    /** El equipo se retira de la cuenta (al cerrar sesión o al entrar con otra cuenta). */
    #[Route('/{id}', methods: ['DELETE'], requirements: ['id' => Requirement::UUID])]
    public function remove(Uuid $id, Request $request, #[CurrentUser] User $user): Response
    {
        $this->devices->remove($this->devices->own($user, $id, DeviceKey::fromRequest($request)));

        return new Response(null, Response::HTTP_NO_CONTENT);
    }

    /** Consulta del propio equipo cada pocos segundos: solicitudes pendientes y señal de vida. */
    #[Route('/{id}/remote-requests', methods: ['GET'], requirements: ['id' => Requirement::UUID])]
    public function pendingRequests(Uuid $id, Request $request, #[CurrentUser] User $user): JsonResponse
    {
        $device = $this->devices->own($user, $id, DeviceKey::fromRequest($request));
        $this->limiter->poll($device);
        $now = new \DateTimeImmutable();
        $this->devices->heartbeat($device, $now);

        return new JsonResponse([
            'requests' => array_map(static fn (RemoteRequest $pending) => [
                'id' => $pending->getId()->toRfc4122(),
                'controllerName' => $pending->getControllerName(),
                'offer' => $pending->getOffer(),
                'createdAt' => $pending->getCreatedAt()->format(\DateTimeInterface::ATOM),
            ], $this->requests->pendingFor($device, $now)),
        ]);
    }

    /** Un controlador de la cuenta pide sesión con su oferta. */
    #[Route('/{id}/remote-requests', methods: ['POST'], requirements: ['id' => Requirement::UUID])]
    public function requestSession(Uuid $id, Request $request, #[CurrentUser] User $user): JsonResponse
    {
        $this->limiter->sessionRequest($user);
        $device = $this->devices->ofUser($user, $id);
        $data = JsonBody::from($request);
        $created = $this->requests->create($device, $this->sessions->current($request), $data['offer'] ?? null);

        return new JsonResponse([
            'id' => $created->getId()->toRfc4122(),
            'expiresAt' => $created->getExpiresAt()->format(\DateTimeInterface::ATOM),
        ], Response::HTTP_CREATED);
    }

    /** @return array<string, mixed> */
    private static function present(Device $device, \DateTimeImmutable $now): array
    {
        return [
            'id' => $device->getId()->toRfc4122(),
            'name' => $device->getName(),
            'platform' => $device->getPlatform()->value,
            'appVersion' => $device->getAppVersion(),
            'online' => $device->isOnline($now),
            'lastSeenAt' => $device->getLastSeenAt()->format(\DateTimeInterface::ATOM),
            'remote' => [
                'state' => $device->getRemoteState()->value,
                // Siempre en el mismo orden: JSONB reordena las claves al guardarlas
                'features' => array_map(static fn (string $feature) => $device->getFeatures()[$feature] ?? false, array_combine(DeviceInfo::FEATURES, DeviceInfo::FEATURES)),
            ],
        ];
    }
}
