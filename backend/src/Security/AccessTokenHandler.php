<?php

namespace App\Security;

use Symfony\Component\HttpFoundation\RequestStack;
use Symfony\Component\Security\Core\Exception\BadCredentialsException;
use Symfony\Component\Security\Http\AccessToken\AccessTokenHandlerInterface;
use Symfony\Component\Security\Http\Authenticator\Passport\Badge\UserBadge;

/** Resuelve el token de "Authorization: Bearer" contra user_session. */
final class AccessTokenHandler implements AccessTokenHandlerInterface
{
    public function __construct(
        private readonly SessionManager $sessions,
        private readonly RequestStack $requestStack,
    ) {
    }

    public function getUserBadgeFrom(#[\SensitiveParameter] string $accessToken): UserBadge
    {
        $session = $this->sessions->findActive($accessToken);
        if (null === $session) {
            // Caducado, revocado o inexistente: AuthenticationFailureHandler responde 401
            throw new BadCredentialsException('Invalid access token.');
        }

        $this->sessions->touch($session);
        $this->requestStack->getCurrentRequest()?->attributes->set(SessionManager::REQUEST_ATTRIBUTE, $session);

        $user = $session->getUser();

        return new UserBadge($user->getUserIdentifier(), static fn () => $user);
    }
}
