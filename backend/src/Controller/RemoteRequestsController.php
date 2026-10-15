<?php

namespace App\Controller;

use App\Api\JsonBody;
use App\Entity\User;
use App\Remote\DeviceKey;
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

/** Respuesta del equipo y espera del controlador en cada solicitud de sesión (add-remote-desktop D5). */
#[Route('/api/remote-requests')]
final class RemoteRequestsController extends AbstractController
{
    public function __construct(
        private readonly RemoteRequests $requests,
        private readonly SessionManager $sessions,
    ) {
    }

    /** El controlador espera aquí la respuesta (consulta cada segundo). */
    #[Route('/{id}', methods: ['GET'], requirements: ['id' => Requirement::UUID])]
    public function show(Uuid $id, Request $request, #[CurrentUser] User $user): JsonResponse
    {
        $remoteRequest = $this->requests->forController($user, $this->sessions->current($request), $id);

        if (null !== $remoteRequest->getAnswer()) {
            return new JsonResponse(['status' => 'answered', 'answer' => $remoteRequest->getAnswer()]);
        }
        if (null !== $remoteRequest->getRejection()) {
            $rejection = ['reason' => $remoteRequest->getRejection()];
            if (null !== $remoteRequest->getRetryAfter()) {
                $rejection['retryAfter'] = $remoteRequest->getRetryAfter();
            }

            return new JsonResponse(['status' => 'rejected', 'rejection' => $rejection]);
        }

        return new JsonResponse(['status' => 'pending']);
    }

    /** El equipo (con su clave) responde con su descripción de sesión o rechaza la solicitud. */
    #[Route('/{id}/answer', methods: ['PUT'], requirements: ['id' => Requirement::UUID])]
    public function answer(Uuid $id, Request $request, #[CurrentUser] User $user): Response
    {
        $this->requests->answer($user, $id, DeviceKey::fromRequest($request), JsonBody::from($request));

        return new Response(null, Response::HTTP_NO_CONTENT);
    }
}
