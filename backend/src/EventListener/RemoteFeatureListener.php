<?php

namespace App\EventListener;

use App\Api\ApiException;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\EventDispatcher\Attribute\AsEventListener;
use Symfony\Component\HttpKernel\Event\RequestEvent;

/**
 * Interruptor general del control remoto (add-remote-desktop, Migration Plan): con
 * REMOTE_ENABLED=0 todos sus endpoints responden 503 y las apps muestran que no está
 * disponible. Va después del firewall: sin token sigue siendo un 401.
 */
#[AsEventListener(event: 'kernel.request', priority: 0)]
final class RemoteFeatureListener
{
    public function __construct(
        #[Autowire(env: 'bool:REMOTE_ENABLED')] private readonly bool $enabled,
    ) {
    }

    public function __invoke(RequestEvent $event): void
    {
        if ($this->enabled || !$event->isMainRequest()) {
            return;
        }
        $path = $event->getRequest()->getPathInfo();
        if (str_starts_with($path, '/api/devices') || str_starts_with($path, '/api/remote') || str_starts_with($path, '/api/host-agent')) {
            throw new ApiException('remote_unavailable', 503);
        }
    }
}
