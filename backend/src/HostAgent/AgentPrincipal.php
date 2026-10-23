<?php

namespace App\HostAgent;

use App\Entity\Device;
use Symfony\Component\Security\Core\User\UserInterface;

/** Identidad de servicio: nunca concede ROLE_USER ni contiene el token de cuenta. */
final readonly class AgentPrincipal implements UserInterface
{
    public function __construct(public Device $device, public string $tokenHash)
    {
    }

    public function getUserIdentifier(): string
    {
        return 'host-agent:'.$this->device->getId()->toRfc4122();
    }

    public function getRoles(): array
    {
        return ['ROLE_HOST_AGENT'];
    }
}
