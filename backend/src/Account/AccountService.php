<?php

namespace App\Account;

use App\Api\ApiException;
use App\Entity\User;
use App\Entity\UserSession;
use App\HostAgent\AgentRegistry;
use App\Repository\UserRepository;
use App\Security\SessionManager;
use Doctrine\DBAL\Exception\UniqueConstraintViolationException;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/** Alta, acceso, cambio de contraseña y borrado de cuentas. */
final class AccountService
{
    public function __construct(
        private readonly EntityManagerInterface $em,
        private readonly UserRepository $users,
        private readonly UserPasswordHasherInterface $hasher,
        private readonly SessionManager $sessions,
        private readonly AgentRegistry $agents,
    ) {
    }

    /** @return array{User, string} la cuenta nueva y el token de su primera sesión */
    public function register(string $email, #[\SensitiveParameter] string $password, string $deviceName): array
    {
        if (null !== $this->users->findOneByEmail($email)) {
            throw new ApiException('email_taken', 409);
        }

        $user = new User($email);
        $user->setPassword($this->hasher->hashPassword($user, $password));
        $this->em->persist($user);
        $token = $this->sessions->open($user, $deviceName);

        try {
            $this->em->flush();
        } catch (UniqueConstraintViolationException) {
            // Dos registros simultáneos con el mismo email
            throw new ApiException('email_taken', 409);
        }

        return [$user, $token];
    }

    /** @return array{User, string} la cuenta y el token de la sesión nueva */
    public function login(string $email, #[\SensitiveParameter] string $password, string $deviceName): array
    {
        $user = '' === $email ? null : $this->users->findOneByEmail($email);
        if (null === $user) {
            // Mismo coste que con un email existente: el tiempo de respuesta no lo delata
            $this->hasher->hashPassword(new User($email), $password);

            throw new ApiException('invalid_credentials', 401);
        }
        if (!$this->hasher->isPasswordValid($user, $password)) {
            throw new ApiException('invalid_credentials', 401);
        }
        if ($this->hasher->needsRehash($user)) {
            $user->setPassword($this->hasher->hashPassword($user, $password));
        }

        $this->sessions->purgeExpired($user);
        $token = $this->sessions->open($user, $deviceName);
        $this->em->flush();

        return [$user, $token];
    }

    /** Cambia la contraseña y cierra las demás sesiones; la actual sigue abierta. */
    public function changePassword(User $user, UserSession $current, #[\SensitiveParameter] string $currentPassword, #[\SensitiveParameter] string $newPassword): void
    {
        $this->assertPassword($user, $currentPassword);
        $this->em->getConnection()->transactional(function () use ($user, $current, $newPassword): void {
            // También revoca el agente vinculado a la sesión actual, que conserva su token de cuenta.
            $this->agents->revokeSources($user);
            $user->setPassword($this->hasher->hashPassword($user, $newPassword));
            $this->em->flush();
            $this->sessions->closeAll($user, keep: $current);
        });
    }

    /** Borra la cuenta; sesiones y conexiones caen con ella (ON DELETE CASCADE). */
    public function delete(User $user, #[\SensitiveParameter] string $password): void
    {
        $this->assertPassword($user, $password);
        $this->em->remove($user);
        $this->em->flush();
    }

    /** Restablecimiento por el operador: contraseña aleatoria y todas las sesiones cerradas. */
    public function resetPassword(User $user): string
    {
        $password = rtrim(strtr(base64_encode(random_bytes(15)), '+/', '-_'), '=');
        $this->em->getConnection()->transactional(function () use ($user, $password): void {
            $this->agents->revokeSources($user);
            $user->setPassword($this->hasher->hashPassword($user, $password));
            $this->em->flush();
            $this->sessions->closeAll($user);
        });

        return $password;
    }

    private function assertPassword(User $user, #[\SensitiveParameter] string $password): void
    {
        if (!$this->hasher->isPasswordValid($user, $password)) {
            throw new ApiException('password_incorrect', 403);
        }
    }
}
