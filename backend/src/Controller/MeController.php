<?php

namespace App\Controller;

use App\Account\AccountService;
use App\Account\Credentials;
use App\Api\JsonBody;
use App\Entity\User;
use App\Security\SessionManager;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\CurrentUser;

#[Route('/api/me')]
final class MeController extends AbstractController
{
    public function __construct(
        private readonly AccountService $accounts,
        private readonly SessionManager $sessions,
    ) {
    }

    #[Route('', methods: ['GET'])]
    public function show(#[CurrentUser] User $user): JsonResponse
    {
        return new JsonResponse([
            'id' => $user->getUserIdentifier(),
            'email' => $user->getEmail(),
            'createdAt' => $user->getCreatedAt()->format(\DateTimeInterface::ATOM),
        ]);
    }

    /** Pide la contraseña actual y cierra las demás sesiones. */
    #[Route('/password', methods: ['PUT'])]
    public function changePassword(Request $request, #[CurrentUser] User $user): Response
    {
        $data = JsonBody::from($request);
        $currentPassword = Credentials::password($data['currentPassword'] ?? null);
        $newPassword = Credentials::newPassword($data['newPassword'] ?? null);

        $this->accounts->changePassword($user, $this->sessions->current($request), $currentPassword, $newPassword);

        return new Response(null, Response::HTTP_NO_CONTENT);
    }

    /** Borra la cuenta con todas sus sesiones y conexiones, confirmando la contraseña. */
    #[Route('', methods: ['DELETE'])]
    public function delete(Request $request, #[CurrentUser] User $user): Response
    {
        $data = JsonBody::from($request);
        $this->accounts->delete($user, Credentials::password($data['password'] ?? null));

        return new Response(null, Response::HTTP_NO_CONTENT);
    }
}
