<?php

namespace App\Controller;

use App\Api\ApiException;
use App\Api\JsonBody;
use App\Connections\ConnectionsConflict;
use App\Connections\ConnectionStore;
use App\Connections\EntryValidator;
use App\Entity\User;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\CurrentUser;

#[Route('/api/connections')]
final class ConnectionsController extends AbstractController
{
    public function __construct(
        private readonly ConnectionStore $store,
        private readonly EntryValidator $validator,
    ) {
    }

    #[Route('', methods: ['GET'])]
    public function list(#[CurrentUser] User $user): JsonResponse
    {
        return new JsonResponse($this->store->snapshot($user));
    }

    /**
     * Reemplaza la lista entera. `revision` es la que tenía el dispositivo al
     * hacer sus cambios: si otro guardó antes, 409 con la lista actual.
     */
    #[Route('', methods: ['PUT'])]
    public function replace(Request $request, #[CurrentUser] User $user): JsonResponse
    {
        $data = JsonBody::from($request);
        $revision = $data['revision'] ?? null;
        if (!\is_int($revision) || $revision < 0) {
            throw new ApiException('connections_invalid', 400, ['reason' => 'invalid_revision']);
        }
        // Se valida todo antes de tocar nada: un guardado rechazado no cambia la lista
        $entries = $this->validator->validate($data['entries'] ?? null);

        try {
            $this->store->replace($user, $revision, $entries);
        } catch (ConnectionsConflict) {
            return new JsonResponse(['error' => ['code' => 'connections_conflict']] + $this->store->snapshot($user), 409);
        }

        return new JsonResponse($this->store->snapshot($user));
    }
}
