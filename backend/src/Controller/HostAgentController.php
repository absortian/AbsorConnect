<?php

namespace App\Controller;

use App\Api\ApiException;
use App\Api\JsonBody;
use App\Entity\Device;
use App\Entity\RemoteRequest;
use App\Entity\User;
use App\HostAgent\AgentInfo;
use App\HostAgent\AgentPrincipal;
use App\HostAgent\AgentRegistry;
use App\Remote\DeviceInfo;
use App\Remote\DeviceKey;
use App\Remote\Devices;
use App\Remote\IceServers;
use App\Remote\RemoteLimiter;
use App\Remote\RemoteRequests;
use App\Security\SessionManager;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Routing\Requirement\Requirement;
use Symfony\Component\Security\Http\Attribute\CurrentUser;
use Symfony\Component\Uid\Uuid;

final class HostAgentController
{
    public function __construct(
        private readonly AgentRegistry $agents,
        private readonly Devices $devices,
        private readonly RemoteRequests $requests,
        private readonly RemoteLimiter $limiter,
        private readonly IceServers $ice,
        private readonly SessionManager $sessions,
        private readonly EntityManagerInterface $em,
    ) {
    }

    #[Route('/api/devices/{id}/agent-enrollments', methods: ['POST'], requirements: ['id' => Requirement::UUID])]
    public function createEnrollment(Uuid $id, Request $request, #[CurrentUser] User $user): JsonResponse
    {
        $this->limiter->sessionRequest($user);

        return new JsonResponse($this->agents->createEnrollment($user, $this->sessions->current($request), $id, DeviceKey::fromRequest($request)), 201, ['Cache-Control' => 'no-store']);
    }

    #[Route('/api/devices/{id}/agent-enrollment-transactions/{transaction}', methods: ['POST'], requirements: ['id' => Requirement::UUID, 'transaction' => Requirement::UUID])]
    public function createTransaction(Uuid $id, Uuid $transaction, Request $request, #[CurrentUser] User $user): JsonResponse
    {
        $this->limiter->sessionRequest($user);

        return new JsonResponse($this->agents->createEnrollment($user, $this->sessions->current($request), $id, DeviceKey::fromRequest($request), $transaction), 201, ['Cache-Control' => 'no-store']);
    }

    #[Route('/api/devices/{id}/agent-enrollment-transactions/{transaction}', methods: ['GET', 'DELETE'], requirements: ['id' => Requirement::UUID, 'transaction' => Requirement::UUID])]
    public function transaction(Uuid $id, Uuid $transaction, Request $request, #[CurrentUser] User $user): JsonResponse
    {
        $this->limiter->sessionRequest($user);
        $source = $this->sessions->current($request);
        $key = DeviceKey::fromRequest($request);
        $result = $request->isMethod('DELETE')
            ? $this->agents->cancelTransaction($user, $source, $id, $key, $transaction)
            : $this->agents->transactionStatus($user, $source, $id, $key, $transaction);

        return new JsonResponse($result, 200, ['Cache-Control' => 'no-store']);
    }

    #[Route('/api/host-agent/enroll', methods: ['POST'])]
    public function enroll(Request $request): JsonResponse
    {
        $this->limiter->agentEnrollmentIp($request->getClientIp() ?? 'unknown');
        $data = JsonBody::from($request);

        return new JsonResponse($this->agents->enroll($data['enrollmentToken'] ?? null, AgentInfo::fromJson($data)), 201, ['Cache-Control' => 'no-store']);
    }

    #[Route('/api/host-agent/device', methods: ['PUT'])]
    public function update(Request $request, #[CurrentUser] AgentPrincipal $agent): JsonResponse
    {
        $data = JsonBody::from($request);
        $info = DeviceInfo::fromJson($data);
        $native = AgentInfo::fromJson($data);

        return $this->agents->operation($agent, function (Device $device, \DateTimeImmutable $now) use ($info, $native): JsonResponse {
            $device->update($info, $now);
            $this->agents->updateInfo($device, $native);
            $this->em->flush();

            return new JsonResponse(['deviceId' => $device->getId()->toRfc4122()]);
        });
    }

    #[Route('/api/host-agent/remote-requests', methods: ['GET'])]
    public function pending(#[CurrentUser] AgentPrincipal $agent): JsonResponse
    {
        return $this->agents->operation($agent, function (Device $device, \DateTimeImmutable $now): JsonResponse {
            $this->limiter->poll($device);
            $this->devices->heartbeat($device, $now);

            return new JsonResponse([
                'requests' => array_map(static fn (RemoteRequest $pending) => [
                    'id' => $pending->getId()->toRfc4122(), 'controllerName' => $pending->getControllerName(),
                    'offer' => $pending->getOffer(), 'createdAt' => $pending->getCreatedAt()->format(\DateTimeInterface::ATOM),
                ], $this->requests->pendingFor($device, $now)),
                'authorization' => ['validForSeconds' => AgentRegistry::LEASE_SECONDS,
                    'authorizedUntil' => $now->modify('+'.AgentRegistry::LEASE_SECONDS.' seconds')->format(\DateTimeInterface::ATOM)],
            ], 200, ['Cache-Control' => 'no-store']);
        });
    }

    #[Route('/api/host-agent/remote-requests/{id}/answer', methods: ['PUT'], requirements: ['id' => Requirement::UUID])]
    public function answer(Uuid $id, Request $request, #[CurrentUser] AgentPrincipal $agent): Response
    {
        return $this->agents->operation($agent, function (Device $device) use ($id, $request): Response {
            $this->requests->answerForAgent($device, $id, JsonBody::from($request));

            return new Response(null, 204);
        });
    }

    #[Route('/api/host-agent/ice-servers', methods: ['GET'])]
    public function iceServers(#[CurrentUser] AgentPrincipal $agent): JsonResponse
    {
        return $this->agents->operation($agent, function (Device $device, \DateTimeImmutable $now): JsonResponse {
            $this->limiter->iceServers($device->getUser());

            return new JsonResponse($this->ice->forUser($device->getUser(), $now), 200, ['Cache-Control' => 'no-store']);
        });
    }

    #[Route('/api/devices/{id}/agent', methods: ['DELETE'], requirements: ['id' => Requirement::UUID])]
    public function revoke(Uuid $id, #[CurrentUser] User|AgentPrincipal $principal): Response
    {
        if ($principal instanceof User) {
            $this->agents->revoke($this->devices->ofUser($principal, $id));
        } else {
            if (!$principal->device->getId()->equals($id)) {
                throw new ApiException('device_not_found', 404);
            }
            $this->agents->operation($principal, fn (Device $device) => $this->agents->revoke($device));
        }

        return new Response(null, 204);
    }
}
