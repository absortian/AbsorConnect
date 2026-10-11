<?php

namespace App\EventListener;

use App\Api\ApiException;
use Psr\Log\LoggerInterface;
use Symfony\Bundle\SecurityBundle\Security;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\EventDispatcher\Attribute\AsEventListener;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpKernel\Event\ExceptionEvent;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Symfony\Component\Security\Core\Exception\AccessDeniedException;
use Symfony\Component\Security\Core\Exception\AuthenticationException;

/** Convierte cualquier excepción bajo /api en JSON estable: {"error": {"code", "details"}}. */
#[AsEventListener(event: 'kernel.exception', priority: 8)]
final class ApiExceptionListener
{
    public function __construct(
        private readonly LoggerInterface $logger,
        private readonly Security $security,
        #[Autowire('%kernel.debug%')] private readonly bool $debug,
    ) {
    }

    public function __invoke(ExceptionEvent $event): void
    {
        if (!str_starts_with($event->getRequest()->getPathInfo(), '/api')) {
            return;
        }

        $e = $event->getThrowable();

        if ($e instanceof ApiException) {
            $event->setResponse($this->json($e->getStatusCode(), $e->getErrorCode(), $e->getDetails(), $e->getHeaders()));

            return;
        }

        if ($e instanceof AuthenticationException) {
            $event->setResponse($this->json(401, 'unauthenticated'));

            return;
        }

        // Sin token, el firewall deniega el acceso: es un 401, no un 403
        if ($e instanceof AccessDeniedException) {
            $authenticated = null !== $this->security->getUser();
            $event->setResponse($this->json($authenticated ? 403 : 401, $authenticated ? 'forbidden' : 'unauthenticated'));

            return;
        }

        if ($e instanceof HttpExceptionInterface) {
            $code = match ($e->getStatusCode()) {
                403 => 'forbidden',
                404 => 'not_found',
                405 => 'method_not_allowed',
                429 => 'too_many_requests',
                default => 'http_error',
            };
            $event->setResponse($this->json($e->getStatusCode(), $code, [], $e->getHeaders()));

            return;
        }

        $this->logger->error('Unhandled API exception: {message}', ['message' => $e->getMessage(), 'exception' => $e]);
        $details = $this->debug ? ['debug' => $e->getMessage()] : [];
        $event->setResponse($this->json(500, 'server_error', $details));
    }

    /**
     * @param array<string, int|string> $details
     * @param array<string, string>     $headers
     */
    private function json(int $status, string $code, array $details = [], array $headers = []): JsonResponse
    {
        $body = ['error' => ['code' => $code]];
        if ([] !== $details) {
            $body['error']['details'] = $details;
        }
        if (401 === $status) {
            $headers['WWW-Authenticate'] = 'Bearer';
        }

        return new JsonResponse($body, $status, $headers);
    }
}
