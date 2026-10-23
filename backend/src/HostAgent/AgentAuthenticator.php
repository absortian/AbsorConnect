<?php

namespace App\HostAgent;

use App\Security\AuthenticationFailureHandler;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Security\Core\Authentication\Token\TokenInterface;
use Symfony\Component\Security\Core\Exception\AuthenticationException;
use Symfony\Component\Security\Core\Exception\BadCredentialsException;
use Symfony\Component\Security\Http\Authenticator\AbstractAuthenticator;
use Symfony\Component\Security\Http\Authenticator\Passport\Badge\UserBadge;
use Symfony\Component\Security\Http\Authenticator\Passport\Passport;
use Symfony\Component\Security\Http\Authenticator\Passport\SelfValidatingPassport;
use Symfony\Component\Security\Http\EntryPoint\AuthenticationEntryPointInterface;

final class AgentAuthenticator extends AbstractAuthenticator implements AuthenticationEntryPointInterface
{
    public function __construct(
        private readonly AgentRegistry $agents,
        private readonly AuthenticationFailureHandler $failures,
    ) {
    }

    public function supports(Request $request): ?bool
    {
        return true;
    }

    public function authenticate(Request $request): Passport
    {
        $header = $request->headers->get('Authorization', '');
        $principal = str_starts_with($header, 'Bearer ') ? $this->agents->authenticate(substr($header, 7)) : null;
        if (null === $principal) {
            throw new BadCredentialsException('Invalid host agent credential.');
        }

        return new SelfValidatingPassport(new UserBadge($principal->getUserIdentifier(), static fn () => $principal));
    }

    public function onAuthenticationSuccess(Request $request, TokenInterface $token, string $firewallName): ?Response
    {
        return null;
    }

    public function onAuthenticationFailure(Request $request, AuthenticationException $exception): ?Response
    {
        return $this->failures->onAuthenticationFailure($request, $exception);
    }

    public function start(Request $request, ?AuthenticationException $authException = null): Response
    {
        return $this->failures->onAuthenticationFailure($request, $authException ?? new BadCredentialsException());
    }
}
