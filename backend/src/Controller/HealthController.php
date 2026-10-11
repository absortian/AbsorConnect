<?php

namespace App\Controller;

use Doctrine\DBAL\Connection;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpKernel\Attribute\AsController;
use Symfony\Component\Routing\Attribute\Route;

/**
 * Readiness: PHP y Postgres responden. La liveness va contra /healthz, que
 * responde Caddy sin pasar por PHP (ver frankenphp/Caddyfile).
 */
#[AsController]
final class HealthController
{
    public function __construct(private readonly Connection $connection)
    {
    }

    #[Route('/api/health', methods: ['GET'])]
    public function __invoke(): JsonResponse
    {
        try {
            $this->connection->executeQuery('SELECT 1');
        } catch (\Throwable) {
            // El worker de FrankenPHP reutiliza la conexión: se cierra para reconectar
            // en la siguiente sonda en vez de seguir con una conexión rota.
            $this->connection->close();

            return new JsonResponse(['error' => ['code' => 'database_unavailable']], 503);
        }

        return new JsonResponse(['status' => 'ok']);
    }
}
