<?php

namespace App\Entity;

use App\Repository\RemoteRequestRepository;
use Doctrine\DBAL\Types\Types;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Bridge\Doctrine\Types\UuidType;
use Symfony\Component\Uid\Uuid;

/**
 * Solicitud de sesión de un controlador a un equipo (add-remote-desktop D3-D5). Solo lleva la
 * negociación de WebRTC (descripciones de sesión con sus candidatos) y se borra al caducar.
 */
#[ORM\Entity(repositoryClass: RemoteRequestRepository::class)]
#[ORM\Table(name: 'remote_request')]
#[ORM\Index(name: 'idx_remote_request_device', columns: ['device_id', 'expires_at'])]
#[ORM\Index(name: 'idx_remote_request_expires', columns: ['expires_at'])]
class RemoteRequest
{
    public const int LIFETIME_SECONDS = 60;
    /** Tamaño máximo de una oferta o una respuesta (SDP con todos sus candidatos). */
    public const int MAX_DESCRIPTION_BYTES = 65536;

    #[ORM\Id]
    #[ORM\Column(type: UuidType::NAME, unique: true)]
    private Uuid $id;

    #[ORM\ManyToOne]
    #[ORM\JoinColumn(nullable: false, onDelete: 'CASCADE')]
    private User $user;

    #[ORM\ManyToOne]
    #[ORM\JoinColumn(nullable: false, onDelete: 'CASCADE')]
    private Device $device;

    /** Solo la sesión que creó la solicitud puede leer la respuesta. */
    #[ORM\ManyToOne]
    #[ORM\JoinColumn(nullable: false, onDelete: 'CASCADE')]
    private UserSession $controllerSession;

    #[ORM\Column(length: 100)]
    private string $controllerName;

    #[ORM\Column(type: Types::TEXT)]
    private string $offer;

    #[ORM\Column(type: Types::TEXT, nullable: true)]
    private ?string $answer = null;

    #[ORM\Column(length: 30, nullable: true)]
    private ?string $rejection = null;

    #[ORM\Column(nullable: true)]
    private ?int $retryAfter = null;

    #[ORM\Column(type: Types::DATETIME_IMMUTABLE)]
    private \DateTimeImmutable $createdAt;

    #[ORM\Column(type: Types::DATETIME_IMMUTABLE)]
    private \DateTimeImmutable $expiresAt;

    public function __construct(Device $device, UserSession $controllerSession, string $offer, \DateTimeImmutable $now)
    {
        $this->id = Uuid::v7();
        $this->user = $device->getUser();
        $this->device = $device;
        $this->controllerSession = $controllerSession;
        $this->controllerName = $controllerSession->getDeviceName();
        $this->offer = $offer;
        $this->createdAt = $now;
        $this->expiresAt = $now->modify('+'.self::LIFETIME_SECONDS.' seconds');
    }

    public function getId(): Uuid
    {
        return $this->id;
    }

    public function getDevice(): Device
    {
        return $this->device;
    }

    public function getControllerSession(): UserSession
    {
        return $this->controllerSession;
    }

    public function getControllerName(): string
    {
        return $this->controllerName;
    }

    public function getOffer(): string
    {
        return $this->offer;
    }

    public function getAnswer(): ?string
    {
        return $this->answer;
    }

    public function getRejection(): ?string
    {
        return $this->rejection;
    }

    public function getRetryAfter(): ?int
    {
        return $this->retryAfter;
    }

    public function getCreatedAt(): \DateTimeImmutable
    {
        return $this->createdAt;
    }

    public function getExpiresAt(): \DateTimeImmutable
    {
        return $this->expiresAt;
    }

    public function isExpired(\DateTimeImmutable $now): bool
    {
        return $this->expiresAt <= $now;
    }

    public function isPending(): bool
    {
        return null === $this->answer && null === $this->rejection;
    }

    public function answer(string $answer): void
    {
        $this->answer = $answer;
    }

    public function reject(string $reason, ?int $retryAfter): void
    {
        $this->rejection = $reason;
        $this->retryAfter = $retryAfter;
    }
}
