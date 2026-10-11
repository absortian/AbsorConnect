<?php

namespace App\Connections;

use App\Entity\ConnectionEntry;
use App\Entity\User;
use App\Repository\ConnectionEntryRepository;
use Doctrine\DBAL\LockMode;
use Doctrine\ORM\EntityManagerInterface;
use Psr\Log\LoggerInterface;

/**
 * Lista de conexiones de una cuenta: lectura con los secretos descifrados y
 * reemplazo completo con control de revisión.
 */
final class ConnectionStore
{
    /**
     * Secreto "ilegible" sin valor detrás: lo guarda una entrada que llega con
     * credentialsUnavailable sin secretos y sin nada guardado (p. ej. migrada desde un
     * equipo que no podía descifrarla). No se puede descifrar, así que la entrada sale
     * marcada hasta que la persona introduzca credenciales nuevas.
     */
    private const string UNAVAILABLE = 'unavailable';

    public function __construct(
        private readonly EntityManagerInterface $em,
        private readonly ConnectionEntryRepository $entries,
        private readonly ConnectionsCrypto $crypto,
        private readonly LoggerInterface $logger,
    ) {
    }

    /** @return array{revision: int, entries: list<array<string, mixed>>} */
    public function snapshot(User $user): array
    {
        return [
            'revision' => $user->getConnectionsRevision(),
            'entries' => array_map(fn (ConnectionEntry $entry) => $this->toArray($user, $entry), $this->entries->findForUser($user)),
        ];
    }

    /**
     * Reemplaza la lista entera si $revision es la actual, en una transacción
     * con la fila de la cuenta bloqueada (SELECT … FOR UPDATE).
     *
     * @param list<ValidEntry> $entries
     *
     * @throws ConnectionsConflict
     */
    public function replace(User $user, int $revision, array $entries): void
    {
        // Sin wrapInTransaction: cierra el EntityManager si algo falla, y tras un
        // conflicto hay que seguir usándolo para devolver la lista actual.
        $connection = $this->em->getConnection();
        $connection->beginTransaction();
        try {
            $this->em->refresh($user, LockMode::PESSIMISTIC_WRITE);
            if ($user->getConnectionsRevision() !== $revision) {
                throw new ConnectionsConflict();
            }

            $stored = [];
            foreach ($this->entries->findForUser($user) as $entry) {
                $stored[$entry->getId()] = $entry;
            }
            foreach ($entries as $position => $valid) {
                $existing = $stored[$valid->id] ?? null;
                unset($stored[$valid->id]);
                $secrets = $this->secretsFor($valid, $existing);
                if (null === $existing) {
                    $this->em->persist(new ConnectionEntry($user, $valid->id, $position, $valid->parentId, $valid->kind, $valid->name, $valid->data, $secrets));
                } else {
                    $existing->update($position, $valid->parentId, $valid->kind, $valid->name, $valid->data, $secrets);
                }
            }
            foreach ($stored as $removed) {
                $this->em->remove($removed);
            }
            $user->bumpConnectionsRevision();

            $this->em->flush();
            $connection->commit();
        } catch (\Throwable $e) {
            $connection->rollBack();

            throw $e;
        }
    }

    /** Valor cifrado que se guarda para la entrada, o null si no tiene secretos. */
    private function secretsFor(ValidEntry $valid, ?ConnectionEntry $existing): ?string
    {
        if (EntryKind::Folder === $valid->kind) {
            return null;
        }
        $stored = $existing?->getSecrets();
        // Secreto ilegible que la persona no ha reemplazado: se conserva tal cual
        if ($valid->credentialsUnavailable && [] === $valid->secrets) {
            return $stored ?? self::UNAVAILABLE;
        }
        if ([] === $valid->secrets) {
            return null;
        }
        // Sin cambios y ya con la clave actual: no se vuelve a cifrar (nonce nuevo = fila nueva)
        if (null !== $stored) {
            $current = $this->crypto->decrypt($stored);
            if (null !== $current && !$current->needsReencryption && self::sorted($current->secrets) === $valid->secrets) {
                return $stored;
            }
        }

        return $this->crypto->encrypt($valid->secrets);
    }

    /** @return array<string, mixed> con la misma forma que ConnectionEntry en la app */
    private function toArray(User $user, ConnectionEntry $entry): array
    {
        $base = ['id' => $entry->getId(), 'name' => $entry->getName(), 'parentId' => $entry->getParentId()];
        $kind = $entry->getKind();
        if (EntryKind::Folder === $kind) {
            return $base + ['isFolder' => true];
        }

        // Claves ordenadas: jsonb no conserva el orden y la respuesta debe ser estable
        $data = $entry->getData();
        ksort($data);
        $result = $base + ['type' => $kind->value] + $data;
        $stored = $entry->getSecrets();
        if (null !== $stored) {
            $decrypted = $this->crypto->decrypt($stored);
            if (null === $decrypted) {
                if (self::UNAVAILABLE !== $stored) {
                    // Solo ids: nunca el valor cifrado ni nada de los secretos
                    $this->logger->warning('Connection secrets could not be decrypted', ['user' => $user->getUserIdentifier(), 'entry' => $entry->getId()]);
                }
                foreach ($kind->secretFields() as $field) {
                    $result[$field] = '';
                }
                $result['credentialsUnavailable'] = true;
            } else {
                $result = array_merge($result, $decrypted->secrets);
            }
        }
        // S3 siempre lleva sus dos claves, aunque estén vacías (como en la app)
        if (EntryKind::S3 === $kind) {
            $result += ['accessKeyId' => '', 'secretAccessKey' => ''];
        }

        return $result;
    }

    /**
     * @param array<string, string> $secrets
     *
     * @return array<string, string>
     */
    private static function sorted(array $secrets): array
    {
        ksort($secrets);

        return $secrets;
    }
}
