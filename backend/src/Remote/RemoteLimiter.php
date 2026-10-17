<?php

namespace App\Remote;

use App\Api\ApiException;
use App\Entity\Device;
use App\Entity\User;
use Symfony\Component\RateLimiter\LimiterInterface;
use Symfony\Component\RateLimiter\RateLimiterFactoryInterface;

/** Límites del control remoto (config/packages/rate_limiter.yaml), comunes a todas las réplicas. */
final class RemoteLimiter
{
    public function __construct(
        private readonly RateLimiterFactoryInterface $remoteRequestUserLimiter,
        private readonly RateLimiterFactoryInterface $devicePollLimiter,
        private readonly RateLimiterFactoryInterface $iceServersUserLimiter,
    ) {
    }

    public function iceServers(User $user): void
    {
        self::consume($this->iceServersUserLimiter->create($user->getId()->toRfc4122()));
    }

    public function sessionRequest(User $user): void
    {
        self::consume($this->remoteRequestUserLimiter->create($user->getId()->toRfc4122()));
    }

    public function poll(Device $device): void
    {
        self::consume($this->devicePollLimiter->create($device->getId()->toRfc4122()));
    }

    private static function consume(LimiterInterface $limiter): void
    {
        $limit = $limiter->consume();
        if (!$limit->isAccepted()) {
            $seconds = max(1, $limit->getRetryAfter()->getTimestamp() - time());

            throw new ApiException('too_many_requests', 429, ['retryAfter' => $seconds], ['Retry-After' => (string) $seconds]);
        }
    }
}
