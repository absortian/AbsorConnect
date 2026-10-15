<?php

namespace App\Remote;

use App\Api\ApiException;

/** Lo que la app publica de su equipo en `PUT /api/devices/{id}`, ya validado. */
final readonly class DeviceInfo
{
    public const array FEATURES = ['clipboard', 'files', 'audio'];

    /** @param array<string, bool> $features */
    public function __construct(
        public string $name,
        public DevicePlatform $platform,
        public string $appVersion,
        public RemoteState $remoteState,
        public array $features,
    ) {
    }

    /** @param array<string, mixed> $data */
    public static function fromJson(array $data): self
    {
        $name = \is_string($data['name'] ?? null) ? trim($data['name']) : '';
        if ('' === $name || mb_strlen($name) > 100) {
            throw self::invalid('name');
        }
        $platform = \is_string($data['platform'] ?? null) ? DevicePlatform::tryFrom($data['platform']) : null;
        if (null === $platform) {
            throw self::invalid('platform');
        }
        $appVersion = $data['appVersion'] ?? null;
        if (!\is_string($appVersion) || !preg_match('/^[0-9A-Za-z.+-]{1,32}$/', $appVersion)) {
            throw self::invalid('appVersion');
        }
        $remote = $data['remote'] ?? null;
        $state = \is_array($remote) && \is_string($remote['state'] ?? null) ? RemoteState::tryFrom($remote['state']) : null;
        if (null === $state) {
            throw self::invalid('remote.state');
        }
        $features = [];
        foreach (self::FEATURES as $feature) {
            $value = $remote['features'][$feature] ?? null;
            if (!\is_bool($value)) {
                throw self::invalid("remote.features.$feature");
            }
            $features[$feature] = $value;
        }

        return new self($name, $platform, $appVersion, $state, $features);
    }

    private static function invalid(string $field): ApiException
    {
        return new ApiException('device_invalid', 400, ['field' => $field]);
    }
}
