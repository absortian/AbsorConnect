<?php

namespace App\Entity;

use App\Repository\UserSessionRepository;
use Doctrine\DBAL\Types\Types;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Bridge\Doctrine\Types\UuidType;
use Symfony\Component\Uid\Uuid;

/**
 * Sesión iniciada en un dispositivo. Del token solo se guarda su SHA-256: quien
 * lea la tabla no puede usar las sesiones.
 */
#[ORM\Entity(repositoryClass: UserSessionRepository::class)]
#[ORM\Table(name: 'user_session')]
#[ORM\Index(name: 'idx_user_session_user', columns: ['user_id'])]
class UserSession
{
    #[ORM\Id]
    #[ORM\Column(type: UuidType::NAME, unique: true)]
    private Uuid $id;

    #[ORM\ManyToOne]
    #[ORM\JoinColumn(nullable: false, onDelete: 'CASCADE')]
    private User $user;

    #[ORM\Column(length: 64, unique: true)]
    private string $tokenHash;

    #[ORM\Column(length: 100)]
    private string $deviceName;

    #[ORM\Column(type: Types::DATETIME_IMMUTABLE)]
    private \DateTimeImmutable $createdAt;

    #[ORM\Column(type: Types::DATETIME_IMMUTABLE)]
    private \DateTimeImmutable $lastUsedAt;

    #[ORM\Column(type: Types::DATETIME_IMMUTABLE)]
    private \DateTimeImmutable $expiresAt;

    public function __construct(User $user, string $tokenHash, string $deviceName, \DateTimeImmutable $expiresAt)
    {
        $this->id = Uuid::v7();
        $this->user = $user;
        $this->tokenHash = $tokenHash;
        $this->deviceName = $deviceName;
        $this->createdAt = new \DateTimeImmutable();
        $this->lastUsedAt = $this->createdAt;
        $this->expiresAt = $expiresAt;
    }

    public function getId(): Uuid
    {
        return $this->id;
    }

    public function getUser(): User
    {
        return $this->user;
    }

    public function getDeviceName(): string
    {
        return $this->deviceName;
    }

    public function getLastUsedAt(): \DateTimeImmutable
    {
        return $this->lastUsedAt;
    }

    public function getExpiresAt(): \DateTimeImmutable
    {
        return $this->expiresAt;
    }

    public function isExpired(\DateTimeImmutable $now): bool
    {
        return $this->expiresAt <= $now;
    }

    public function touch(\DateTimeImmutable $now, \DateTimeImmutable $expiresAt): void
    {
        $this->lastUsedAt = $now;
        $this->expiresAt = $expiresAt;
    }
}
