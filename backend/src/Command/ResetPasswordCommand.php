<?php

namespace App\Command;

use App\Account\AccountService;
use App\Account\Credentials;
use App\Repository\UserRepository;
use Symfony\Component\Console\Attribute\Argument;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Style\SymfonyStyle;

/** No hay recuperación por correo: el operador genera una contraseña nueva y se la comunica a la persona. */
#[AsCommand(name: 'app:user:reset-password', description: 'Genera una contraseña nueva para una cuenta y cierra todas sus sesiones')]
final class ResetPasswordCommand
{
    public function __construct(
        private readonly UserRepository $users,
        private readonly AccountService $accounts,
    ) {
    }

    public function __invoke(SymfonyStyle $io, #[Argument(description: 'Email de la cuenta')] string $email): int
    {
        $user = $this->users->findOneByEmail(Credentials::normalizeEmail($email));
        if (null === $user) {
            $io->error(\sprintf('No existe ninguna cuenta con el email «%s».', $email));

            return Command::FAILURE;
        }

        $password = $this->accounts->resetPassword($user);

        $io->success(\sprintf('Contraseña restablecida para %s. Se han cerrado todas sus sesiones; sus conexiones siguen intactas.', $user->getEmail()));
        $io->writeln('Contraseña nueva (no se volverá a mostrar):');
        $io->writeln($password);

        return Command::SUCCESS;
    }
}
