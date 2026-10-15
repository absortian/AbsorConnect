<?php

namespace App\Remote;

use App\Api\ApiException;
use Symfony\Component\HttpFoundation\Request;

/**
 * Clave secreta de cada equipo (add-remote-desktop D4): la genera la app y la envía en
 * `X-Device-Key` en las operaciones del propio equipo. En BD solo queda su SHA-256.
 */
final class DeviceKey
{
    public const string HEADER = 'X-Device-Key';

    public static function fromRequest(Request $request): string
    {
        $key = $request->headers->get(self::HEADER);
        // 403 y no 401: la app trata cualquier 401 como sesión caducada
        if (!\is_string($key) || !preg_match('/^[A-Za-z0-9_-]{32,128}$/', $key)) {
            throw new ApiException('device_key_invalid', 403);
        }

        return $key;
    }

    public static function hash(#[\SensitiveParameter] string $key): string
    {
        return hash('sha256', $key);
    }
}
