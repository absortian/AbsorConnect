<?php

namespace App\Account;

use App\Api\ApiException;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\RateLimiter\LimiterInterface;
use Symfony\Component\RateLimiter\RateLimiterFactoryInterface;

/**
 * Límites del registro abierto y del inicio de sesión (config/packages/rate_limiter.yaml).
 * La IP es la del cliente tras los proxies de confianza (TRUSTED_PROXIES).
 */
final class AttemptLimiter
{
    public function __construct(
        private readonly RateLimiterFactoryInterface $registerIpLimiter,
        private readonly RateLimiterFactoryInterface $loginEmailLimiter,
        private readonly RateLimiterFactoryInterface $loginIpLimiter,
    ) {
    }

    public function registration(Request $request): void
    {
        self::consume($this->registerIpLimiter->create(self::ip($request)));
    }

    /** @param string $email normalizado (Credentials::normalizeEmail) */
    public function login(Request $request, string $email): void
    {
        self::consume($this->loginIpLimiter->create(self::ip($request)));
        self::consume($this->loginEmailLimiter->create($email));
    }

    /** Un inicio de sesión correcto pone a cero los fallos de ese email. */
    public function loginSucceeded(string $email): void
    {
        $this->loginEmailLimiter->create($email)->reset();
    }

    private static function consume(LimiterInterface $limiter): void
    {
        $limit = $limiter->consume();
        if (!$limit->isAccepted()) {
            throw ApiException::tooManyAttempts($limit->getRetryAfter());
        }
    }

    private static function ip(Request $request): string
    {
        return $request->getClientIp() ?? 'unknown';
    }
}
