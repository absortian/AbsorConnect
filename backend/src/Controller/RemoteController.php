<?php

namespace App\Controller;

use App\Entity\User;
use App\Remote\IceServers;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\CurrentUser;

#[Route('/api/remote')]
final class RemoteController extends AbstractController
{
    public function __construct(
        private readonly IceServers $iceServers,
    ) {
    }

    /** Servidores STUN y TURN para la conexión entre equipos (add-remote-desktop D13). */
    #[Route('/ice-servers', methods: ['GET'])]
    public function iceServers(#[CurrentUser] User $user): JsonResponse
    {
        return new JsonResponse($this->iceServers->forUser($user, new \DateTimeImmutable()));
    }
}
