<?php

namespace App\Security;

use App\Entity\User;
use App\Entity\UserSession;
use App\Repository\UserSessionRepository;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\HttpFoundation\Request;

/**
 * Sesiones por dispositivo con token opaco: "acs_" + 32 bytes aleatorios en
 * base64url. En BD solo queda el SHA-256, y la caducidad se desliza con el uso.
 */
final class SessionManager
{
    /** Atributo de la petición con la UserSession autenticada (lo fija AccessTokenHandler). */
    public const string REQUEST_ATTRIBUTE = '_app_user_session';

    private const string TOKEN_PREFIX = 'acs_';
    private const string LIFETIME = '+90 days';
    /** Como mucho una escritura por hora y sesión para deslizar la caducidad. */
    private const int TOUCH_INTERVAL_SECONDS = 3600;

    public function __construct(
        private readonly EntityManagerInterface $em,
        private readonly UserSessionRepository $sessions,
    ) {
    }

    /**
     * Abre una sesión y devuelve el token en claro: es la única vez que existe
     * fuera del dispositivo. No hace flush.
     */
    public function open(User $user, string $deviceName): string
    {
        $token = self::TOKEN_PREFIX.rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
        $this->em->persist(new UserSession($user, self::hash($token), $deviceName, new \DateTimeImmutable(self::LIFETIME)));

        return $token;
    }

    public function findActive(#[\SensitiveParameter] string $token): ?UserSession
    {
        if (!str_starts_with($token, self::TOKEN_PREFIX) || \strlen($token) > 128) {
            return null;
        }

        return $this->sessions->findActiveByTokenHash(self::hash($token), new \DateTimeImmutable());
    }

    /** Desliza la caducidad 90 días desde ahora, si la última vez fue hace más de una hora. */
    public function touch(UserSession $session): void
    {
        $now = new \DateTimeImmutable();
        if ($now->getTimestamp() - $session->getLastUsedAt()->getTimestamp() < self::TOUCH_INTERVAL_SECONDS) {
            return;
        }
        $session->touch($now, $now->modify(self::LIFETIME));
        $this->em->flush();
    }

    /** Sesión con la que se ha autenticado la petición actual. */
    public function current(Request $request): UserSession
    {
        $session = $request->attributes->get(self::REQUEST_ATTRIBUTE);
        if (!$session instanceof UserSession) {
            throw new \LogicException('The request was not authenticated with an access token.');
        }

        return $session;
    }

    public function close(UserSession $session): void
    {
        $this->em->remove($session);
        $this->em->flush();
    }

    /** Revoca todas las sesiones de la cuenta, salvo $keep si se indica. */
    public function closeAll(User $user, ?UserSession $keep = null): void
    {
        $this->sessions->deleteForUser($user, $keep);
    }

    /** Limpieza al iniciar sesión: así no hace falta un CronJob para las caducadas. */
    public function purgeExpired(User $user): void
    {
        $this->sessions->deleteExpiredForUser($user, new \DateTimeImmutable());
    }

    public static function hash(#[\SensitiveParameter] string $token): string
    {
        return hash('sha256', $token);
    }
}
