<?php

namespace App\Controller;

use App\Account\AccountService;
use App\Account\AttemptLimiter;
use App\Account\Credentials;
use App\Api\JsonBody;
use App\Entity\User;
use App\Security\SessionManager;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;

#[Route('/api/auth')]
final class AuthController extends AbstractController
{
    public function __construct(
        private readonly AccountService $accounts,
        private readonly Credentials $credentials,
        private readonly AttemptLimiter $limiter,
        private readonly SessionManager $sessions,
    ) {
    }

    /** Registro abierto: sin verificación de email, deja la sesión iniciada. */
    #[Route('/register', methods: ['POST'])]
    public function register(Request $request): JsonResponse
    {
        $this->limiter->registration($request);
        $data = JsonBody::from($request);
        $email = $this->credentials->email($data['email'] ?? null);
        $password = Credentials::newPassword($data['password'] ?? null);

        [$user, $token] = $this->accounts->register($email, $password, Credentials::deviceName($data['deviceName'] ?? null));

        return new JsonResponse(['token' => $token, 'user' => self::user($user)], 201);
    }

    #[Route('/login', methods: ['POST'])]
    public function login(Request $request): JsonResponse
    {
        $data = JsonBody::from($request);
        $email = Credentials::normalizeEmail($data['email'] ?? null);
        $this->limiter->login($request, $email);

        [$user, $token] = $this->accounts->login($email, Credentials::password($data['password'] ?? null), Credentials::deviceName($data['deviceName'] ?? null));
        $this->limiter->loginSucceeded($email);

        return new JsonResponse(['token' => $token, 'user' => self::user($user)]);
    }

    /** Cierra la sesión de este dispositivo; las demás siguen abiertas. */
    #[Route('/logout', methods: ['POST'])]
    public function logout(Request $request): Response
    {
        $this->sessions->close($this->sessions->current($request));

        return new Response(null, Response::HTTP_NO_CONTENT);
    }

    /** @return array{id: string, email: string} */
    private static function user(User $user): array
    {
        return ['id' => $user->getUserIdentifier(), 'email' => $user->getEmail()];
    }
}
