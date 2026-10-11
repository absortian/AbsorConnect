<?php

namespace App\Entity;

use App\Connections\EntryKind;
use App\Repository\ConnectionEntryRepository;
use Doctrine\DBAL\Types\Types;
use Doctrine\ORM\Mapping as ORM;

/**
 * Conexión o carpeta de la lista de una cuenta. El `id` lo genera la app, así
 * que la clave es (user_id, id): dos cuentas pueden usar el mismo id sin chocar.
 */
#[ORM\Entity(repositoryClass: ConnectionEntryRepository::class)]
#[ORM\Table(name: 'connection_entry')]
class ConnectionEntry
{
    #[ORM\Id]
    #[ORM\ManyToOne]
    #[ORM\JoinColumn(nullable: false, onDelete: 'CASCADE')]
    private User $user;

    #[ORM\Id]
    #[ORM\Column(length: 64)]
    private string $id;

    #[ORM\Column]
    private int $position;

    #[ORM\Column(length: 64, nullable: true)]
    private ?string $parentId;

    #[ORM\Column(length: 10, enumType: EntryKind::class)]
    private EntryKind $kind;

    #[ORM\Column(type: Types::TEXT)]
    private string $name;

    /** @var array<string, scalar|null> campos no secretos del tipo (host, port, endpoint…) */
    #[ORM\Column(type: Types::JSON, options: ['jsonb' => true])]
    private array $data;

    /** Secretos cifrados con ConnectionsCrypto ("v1:…"), o null si no hay. */
    #[ORM\Column(type: Types::TEXT, nullable: true)]
    private ?string $secrets;

    #[ORM\Column(type: Types::DATETIME_IMMUTABLE)]
    private \DateTimeImmutable $updatedAt;

    /** @param array<string, scalar|null> $data */
    public function __construct(User $user, string $id, int $position, ?string $parentId, EntryKind $kind, string $name, array $data, ?string $secrets)
    {
        $this->user = $user;
        $this->id = $id;
        $this->position = $position;
        $this->parentId = $parentId;
        $this->kind = $kind;
        $this->name = $name;
        $this->data = $data;
        $this->secrets = $secrets;
        $this->updatedAt = new \DateTimeImmutable();
    }

    /** @param array<string, scalar|null> $data */
    public function update(int $position, ?string $parentId, EntryKind $kind, string $name, array $data, ?string $secrets): void
    {
        $changed = $this->position !== $position
            || $this->parentId !== $parentId
            || $this->kind !== $kind
            || $this->name !== $name
            || !self::sameData($this->data, $data)
            || $this->secrets !== $secrets;
        if (!$changed) {
            return;
        }
        $this->position = $position;
        $this->parentId = $parentId;
        $this->kind = $kind;
        $this->name = $name;
        $this->data = $data;
        $this->secrets = $secrets;
        $this->updatedAt = new \DateTimeImmutable();
    }

    /**
     * jsonb no conserva el orden de las claves: se comparan ordenadas.
     *
     * @param array<string, scalar|null> $a
     * @param array<string, scalar|null> $b
     */
    private static function sameData(array $a, array $b): bool
    {
        ksort($a);
        ksort($b);

        return $a === $b;
    }

    public function getId(): string
    {
        return $this->id;
    }

    public function getPosition(): int
    {
        return $this->position;
    }

    public function getParentId(): ?string
    {
        return $this->parentId;
    }

    public function getKind(): EntryKind
    {
        return $this->kind;
    }

    public function getName(): string
    {
        return $this->name;
    }

    /** @return array<string, scalar|null> */
    public function getData(): array
    {
        return $this->data;
    }

    public function getSecrets(): ?string
    {
        return $this->secrets;
    }

    public function getUpdatedAt(): \DateTimeImmutable
    {
        return $this->updatedAt;
    }
}
