<?php

namespace App\Tests\Unit;

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
}
