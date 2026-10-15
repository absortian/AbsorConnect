<?php

namespace App\Entity;

use App\Remote\DeviceInfo;
use App\Remote\DevicePlatform;
use App\Remote\RemoteState;
use App\Repository\DeviceRepository;
use Doctrine\DBAL\Types\Types;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Bridge\Doctrine\Types\UuidType;
use Symfony\Component\Uid\Uuid;

/**
 * Instalación de la app de escritorio registrada en una cuenta (add-remote-desktop D4). El
 * identificador lo genera la app; de su clave solo se guarda el SHA-256.
 */
#[ORM\Entity(repositoryClass: DeviceRepository::class)]
#[ORM\Table(name: 'device')]
#[ORM\Index(name: 'idx_device_user', columns: ['user_id'])]
#[ORM\Index(name: 'idx_device_last_seen', columns: ['last_seen_at'])]
class Device
{
    /** Sin contacto en este tiempo, el equipo aparece sin conexión. */
    public const int ONLINE_SECONDS = 30;

    #[ORM\Id]
    #[ORM\Column(type: UuidType::NAME, unique: true)]
    private Uuid $id;

    #[ORM\ManyToOne]
    #[ORM\JoinColumn(nullable: false, onDelete: 'CASCADE')]
    private User $user;

    #[ORM\Column(length: 64)]
    private string $keyHash;

    #[ORM\Column(length: 100)]
    private string $name;

    #[ORM\Column(length: 10, enumType: DevicePlatform::class)]
    private DevicePlatform $platform;

    #[ORM\Column(length: 32)]
    private string $appVersion;

    #[ORM\Column(length: 20, enumType: RemoteState::class)]
    private RemoteState $remoteState;

    /** @var array<string, bool> */
    #[ORM\Column(type: Types::JSON, options: ['jsonb' => true])]
    private array $features;

    #[ORM\Column(type: Types::DATETIME_IMMUTABLE)]
    private \DateTimeImmutable $lastSeenAt;

    #[ORM\Column(type: Types::DATETIME_IMMUTABLE)]
    private \DateTimeImmutable $createdAt;

    public function __construct(Uuid $id, User $user, string $keyHash, DeviceInfo $info, \DateTimeImmutable $now)
    {
        $this->id = $id;
        $this->user = $user;
        $this->keyHash = $keyHash;
        $this->createdAt = $now;
        $this->lastSeenAt = $now;
        $this->update($info, $now);
    }

    public function update(DeviceInfo $info, \DateTimeImmutable $now): void
    {
        $this->name = $info->name;
        $this->platform = $info->platform;
        $this->appVersion = $info->appVersion;
        $this->remoteState = $info->remoteState;
        $this->features = $info->features;
        $this->lastSeenAt = $now;
    }

    public function getId(): Uuid
    {
        return $this->id;
    }

    public function getUser(): User
    {
        return $this->user;
    }

    public function getKeyHash(): string
    {
        return $this->keyHash;
    }

    public function getName(): string
    {
        return $this->name;
    }

    public function getPlatform(): DevicePlatform
    {
        return $this->platform;
    }

    public function getAppVersion(): string
    {
        return $this->appVersion;
    }

    public function getRemoteState(): RemoteState
    {
        return $this->remoteState;
    }

    /** @return array<string, bool> */
    public function getFeatures(): array
    {
        return $this->features;
    }

    public function getLastSeenAt(): \DateTimeImmutable
    {
        return $this->lastSeenAt;
    }

    public function isOnline(\DateTimeImmutable $now): bool
    {
        return $now->getTimestamp() - $this->lastSeenAt->getTimestamp() <= self::ONLINE_SECONDS;
    }

    public function touch(\DateTimeImmutable $now): void
    {
        $this->lastSeenAt = $now;
    }
}
