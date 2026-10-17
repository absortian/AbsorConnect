<?php

namespace App\Remote;

use App\Entity\User;
use Symfony\Component\DependencyInjection\Attribute\Autowire;

/**
 * Servidores ICE para WebRTC (add-remote-desktop D13): STUN y, si está configurado, el relé
 * TURN propio con credenciales temporales según la API REST de coturn (use-auth-secret).
 */
final class IceServers
{
    /** Validez máxima de las credenciales; la caducidad se redondea a la hora (entre 23 y 24 h). */
    public const int TTL_SECONDS = 86400;

    public function __construct(
        #[Autowire(env: 'STUN_URLS')] private readonly string $stunUrls,
        #[Autowire(env: 'TURN_URLS')] private readonly string $turnUrls,
        #[Autowire(env: 'TURN_SECRET')] private readonly string $turnSecret,
    ) {
    }

    /** @return array{iceServers: list<array<string, mixed>>, ttl: int} */
    public function forUser(User $user, \DateTimeImmutable $now): array
    {
        $expiry = self::expiry($now);
        $servers = [];
        $stun = self::urls($this->stunUrls);
        if ([] !== $stun) {
            $servers[] = ['urls' => $stun];
        }
        $turn = self::urls($this->turnUrls);
        if ([] !== $turn && '' !== $this->turnSecret) {
            // El relé comprueba la firma y la caducidad que lleva el propio nombre de usuario
            $username = $expiry.':'.$user->getId()->toRfc4122();
            $servers[] = ['urls' => $turn, 'username' => $username, 'credential' => self::credential($this->turnSecret, $username)];
        }

        return ['iceServers' => $servers, 'ttl' => $expiry - $now->getTimestamp()];
    }

    /**
     * Caducidad redondeada hacia abajo a la hora: la misma cuenta recibe el mismo nombre de
     * usuario durante toda la hora. La cuota por usuario del relé (user-quota) cuenta por nombre,
     * y con uno distinto en cada petición una cuenta podría acumular asignaciones sin límite.
     */
    public static function expiry(\DateTimeImmutable $now): int
    {
        return intdiv($now->getTimestamp(), 3600) * 3600 + self::TTL_SECONDS;
    }

    /** base64(HMAC-SHA1(secreto, usuario)): lo que espera coturn con use-auth-secret. */
    public static function credential(#[\SensitiveParameter] string $secret, string $username): string
    {
        return base64_encode(hash_hmac('sha1', $username, $secret, true));
    }

    /** @return list<string> */
    private static function urls(string $value): array
    {
        return array_values(array_filter(array_map('trim', explode(',', $value)), static fn (string $url) => '' !== $url));
    }
}
