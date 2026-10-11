<?php

namespace App\Api;

use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * Error de negocio de la API. `code` es un identificador estable que la app
 * traduce (p. ej. "email_taken", "connections_conflict").
 */
class ApiException extends HttpException
{
    /**
     * @param array<string, int|string> $details
     * @param array<string, string>     $headers
     */
    public function __construct(
        private readonly string $errorCode,
        int $statusCode = 400,
        private readonly array $details = [],
        array $headers = [],
    ) {
        parent::__construct($statusCode, $errorCode, null, $headers);
    }

    public function getErrorCode(): string
    {
        return $this->errorCode;
    }

    /** @return array<string, int|string> */
    public function getDetails(): array
    {
        return $this->details;
    }

    public static function tooManyAttempts(?\DateTimeImmutable $retryAfter): self
    {
        $seconds = null === $retryAfter ? 60 : max(1, $retryAfter->getTimestamp() - time());

        return new self('too_many_attempts', 429, [], ['Retry-After' => (string) $seconds]);
    }
}
