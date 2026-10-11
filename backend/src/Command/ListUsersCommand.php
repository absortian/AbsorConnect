<?php

namespace App\Command;

use Doctrine\DBAL\Connection;
use Doctrine\DBAL\Types\Types;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Style\SymfonyStyle;

/** Para soporte: nunca muestra contraseñas, tokens ni secretos. */
#[AsCommand(name: 'app:user:list', description: 'Lista las cuentas con su número de conexiones y de sesiones activas')]
final class ListUsersCommand
{
    public function __construct(private readonly Connection $connection)
    {
    }

    public function __invoke(SymfonyStyle $io): int
    {
        $rows = $this->connection->fetchAllAssociative(<<<'SQL'
            SELECT u.email,
                   u.created_at,
                   (SELECT COUNT(*) FROM connection_entry c WHERE c.user_id = u.id AND c.kind <> 'folder') AS connections,
                   (SELECT COUNT(*) FROM user_session s WHERE s.user_id = u.id AND s.expires_at > :now) AS sessions
            FROM app_user u
            ORDER BY u.created_at
            SQL,
            // Hora de PHP (UTC), no NOW(): las columnas no llevan zona horaria y el
            // Postgres compartido puede tener otra configurada.
            ['now' => new \DateTimeImmutable()],
            ['now' => Types::DATETIME_IMMUTABLE],
        );

        $io->table(
            ['Email', 'Alta', 'Conexiones', 'Sesiones activas'],
            array_map(static fn (array $row) => [$row['email'], substr((string) $row['created_at'], 0, 16), $row['connections'], $row['sessions']], $rows),
        );
        $io->writeln(\sprintf('%d cuenta(s)', \count($rows)));

        return Command::SUCCESS;
    }
}
