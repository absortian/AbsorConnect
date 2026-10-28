<?php

namespace App\Entity;

use Doctrine\DBAL\Types\Types;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Bridge\Doctrine\Types\UuidType;
use Symfony\Component\Uid\Uuid;

/** Intención/lápida, sin secretos. AgentRegistry serializa sus cambios bajo device. */
#[ORM\Entity]
#[ORM\Table(name: 'agent_enrollment_transaction')]
#[ORM\Index(name: 'IDX_AGENT_ENROLLMENT_TX_SOURCE', columns: ['source_session_id'])]
final class AgentEnrollmentTransaction
{
    #[ORM\Id]
    #[ORM\ManyToOne]
    #[ORM\JoinColumn(nullable: false, onDelete: 'CASCADE')]
    private Device $device;

    #[ORM\Id]
    #[ORM\Column(type: UuidType::NAME)]
    private Uuid $transactionId;

    #[ORM\ManyToOne]
    #[ORM\JoinColumn(nullable: false, onDelete: 'CASCADE')]
    private UserSession $sourceSession;

    #[ORM\Column(length: 16)]
    private string $state;

    #[ORM\Column(type: Types::DATETIME_IMMUTABLE)]
    private \DateTimeImmutable $createdAt;

    #[ORM\Column(type: Types::DATETIME_IMMUTABLE)]
    private \DateTimeImmutable $updatedAt;
}
