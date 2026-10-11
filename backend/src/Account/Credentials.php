<?php

namespace App\Account;

use App\Api\ApiException;
use Symfony\Component\Validator\Constraints as Assert;
use Symfony\Component\Validator\Validator\ValidatorInterface;

/** Lectura y validación de email, contraseña y nombre del dispositivo. */
final class Credentials
{
    public const int PASSWORD_MIN_LENGTH = 10;
    /** El mismo tope que aplica el hasher de Symfony. */
    public const int PASSWORD_MAX_BYTES = 4096;
    private const int EMAIL_MAX_LENGTH = 180;
    private const int DEVICE_NAME_MAX_LENGTH = 100;

    public function __construct(private readonly ValidatorInterface $validator)
    {
    }

    /** Email normalizado y válido para crear una cuenta. */
    public function email(mixed $value): string
    {
        $email = self::normalizeEmail($value);
        $violations = $this->validator->validate($email, [
            new Assert\NotBlank(),
            new Assert\Length(max: self::EMAIL_MAX_LENGTH),
            new Assert\Email(mode: Assert\Email::VALIDATION_MODE_HTML5),
        ]);
        if (\count($violations) > 0) {
            throw new ApiException('email_invalid');
        }

        return $email;
    }

    /** El email se compara sin distinguir mayúsculas: se guarda y se busca en minúsculas. */
    public static function normalizeEmail(mixed $value): string
    {
        return \is_string($value) ? strtolower(trim($value)) : '';
    }

    /** Contraseña nueva (registro o cambio). */
    public static function newPassword(mixed $value): string
    {
        if (!\is_string($value) || mb_strlen($value) < self::PASSWORD_MIN_LENGTH) {
            throw new ApiException('password_too_short');
        }
        if (\strlen($value) > self::PASSWORD_MAX_BYTES) {
            throw new ApiException('password_too_long');
        }

        return $value;
    }

    /** Contraseña que solo se comprueba contra el hash: una no válida simplemente no coincide. */
    public static function password(mixed $value): string
    {
        return \is_string($value) && \strlen($value) <= self::PASSWORD_MAX_BYTES ? $value : '';
    }

    public static function deviceName(mixed $value): string
    {
        $name = \is_string($value) ? trim((string) preg_replace('/\p{C}+/u', ' ', $value)) : '';

        return '' === $name ? 'unknown' : mb_substr($name, 0, self::DEVICE_NAME_MAX_LENGTH);
    }
}
