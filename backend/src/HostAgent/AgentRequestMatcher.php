<?php

namespace App\HostAgent;

use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\RequestMatcherInterface;

/** La baja admite cuenta o agente; las demás rutas de cuenta siguen en su firewall. */
final class AgentRequestMatcher implements RequestMatcherInterface
{
    public function matches(Request $request): bool
    {
        return str_starts_with($request->getPathInfo(), '/api/host-agent/')
            || ($request->isMethod('DELETE')
                && preg_match('#^/api/devices/[0-9a-fA-F-]{36}/agent$#D', $request->getPathInfo())
                && str_starts_with($request->headers->get('Authorization', ''), 'Bearer acg_'));
    }
}
