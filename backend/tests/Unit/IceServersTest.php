<?php

namespace App\Tests\Unit;

use App\Entity\User;
use App\Remote\IceServers;
use PHPUnit\Framework\TestCase;

final class IceServersTest extends TestCase
{
    public function testCredentialMatchesCoturnRestApi(): void
    {
        // Calculado aparte: base64(HMAC-SHA1("secreto-del-rele", usuario))
        self::assertSame(
            'W8QcmPe92Hph87vdnRoAnYINp1k=',
            IceServers::credential('secreto-del-rele', '1760000000:0199e3a0-1c2d-7a00-8000-0000000000c3'),
        );
    }

    public function testSameUsernameDuringTheHourAndNoMoreThan24Hours(): void
    {
        $servers = new IceServers('', 'turn:turn.ejemplo.com:3478', 'secreto-del-rele');
        $user = new User('persona@ejemplo.com');
        $username = static fn (string $at): string => $servers->forUser($user, new \DateTimeImmutable($at))['iceServers'][0]['username'];

        $first = $username('2026-10-17 18:00:05 UTC');
        self::assertSame($first, $username('2026-10-17 18:59:59 UTC'));
        self::assertNotSame($first, $username('2026-10-17 19:00:00 UTC'));
        self::assertSame((new \DateTimeImmutable('2026-10-18 18:00:00 UTC'))->getTimestamp(), (int) explode(':', $first)[0]);

        // A las 18:59:59 quedan 23 h y 1 s: nunca más de 24 h desde que se emiten
        $late = $servers->forUser($user, new \DateTimeImmutable('2026-10-17 18:59:59 UTC'));
        self::assertSame(23 * 3600 + 1, $late['ttl']);
    }
}
