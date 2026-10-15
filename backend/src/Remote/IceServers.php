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
        $servers = [];
        $stun = self::urls($this->stunUrls);
        if ([] !== $stun) {
            $servers[] = ['urls' => $stun];
        }
        $turn = self::urls($this->turnUrls);
        if ([] !== $turn && '' !== $this->turnSecret) {
            // El relé comprueba la firma y la caducidad que lleva el propio nombre de usuario
            $username = ($now->getTimestamp() + self::TTL_SECONDS).':'.$user->getId()->toRfc4122();
            $servers[] = ['urls' => $turn, 'username' => $username, 'credential' => self::credential($this->turnSecret, $username)];
        }

        return ['iceServers' => $servers, 'ttl' => self::TTL_SECONDS];
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
