<?php

namespace App\Tests\Api;

use App\Tests\ApiTestCase;

/** Escenarios de "Cambio de contraseña" y "Borrado de la cuenta". */
final class AccountTest extends ApiTestCase
{
    private const string NEW_PASSWORD = 'otra-contraseña-nueva';

    public function testChangePasswordKeepsCurrentSessionAndRevokesTheOthers(): void
    {
        $current = $this->register()['token'];
        $other = $this->login();

        $this->putJson('/api/me/password', ['currentPassword' => self::PASSWORD, 'newPassword' => self::NEW_PASSWORD], self::auth($current));
        self::assertResponseStatusCodeSame(204);

        $this->getJson('/api/me', self::auth($current));
        self::assertResponseIsSuccessful();
        $this->getJson('/api/me', self::auth($other));
        self::assertResponseStatusCodeSame(401);

        $this->login(password: self::NEW_PASSWORD);
        $this->postJson('/api/auth/login', ['email' => 'ana@ejemplo.com', 'password' => self::PASSWORD, 'deviceName' => 'x']);
        self::assertResponseStatusCodeSame(401);
        self::assertSame('invalid_credentials', $this->errorCode());
    }

    public function testWrongCurrentPasswordChangesNothing(): void
    {
        $current = $this->register()['token'];
        $other = $this->login();

        $this->putJson('/api/me/password', ['currentPassword' => 'no-es-esta', 'newPassword' => self::NEW_PASSWORD], self::auth($current));

        self::assertResponseStatusCodeSame(403);
        self::assertSame('password_incorrect', $this->errorCode());
        $this->getJson('/api/me', self::auth($other));
        self::assertResponseIsSuccessful();
        $this->login();
    }

    public function testNewPasswordMustBeLongEnough(): void
    {
        $token = $this->register()['token'];

        $this->putJson('/api/me/password', ['currentPassword' => self::PASSWORD, 'newPassword' => 'corta'], self::auth($token));

        self::assertResponseStatusCodeSame(400);
        self::assertSame('password_too_short', $this->errorCode());
        $this->login();
    }

    public function testDeleteAccountRemovesEverything(): void
    {
        $token = $this->register()['token'];
        $this->login();
        $this->putJson('/api/connections', ['revision' => 0, 'entries' => [
            ['id' => 'f1', 'name' => 'Carpeta', 'isFolder' => true],
            ['id' => 'c1', 'name' => 'S3', 'parentId' => 'f1', 'type' => 's3', 'endpoint' => 'https://s3.test', 'accessKeyId' => 'AK', 'secretAccessKey' => 'SK'],
        ]], self::auth($token));
        self::assertResponseIsSuccessful();
        $userId = $this->getJson('/api/me', self::auth($token))['id'];

        $this->deleteJson('/api/me', ['password' => self::PASSWORD], self::auth($token));
        self::assertResponseStatusCodeSame(204);

        foreach (['app_user' => 'id', 'user_session' => 'user_id', 'connection_entry' => 'user_id'] as $table => $column) {
            self::assertSame(0, (int) $this->db()->fetchOne("SELECT COUNT(*) FROM $table WHERE $column = ?", [$userId]), $table);
        }
        $this->getJson('/api/me', self::auth($token));
        self::assertResponseStatusCodeSame(401);

        // El email queda libre
        $this->register();
    }

    public function testDeleteAccountNeedsThePassword(): void
    {
        $token = $this->register()['token'];

        $this->deleteJson('/api/me', ['password' => 'no-es-esta'], self::auth($token));

        self::assertResponseStatusCodeSame(403);
        self::assertSame('password_incorrect', $this->errorCode());
        self::assertSame(1, (int) $this->db()->fetchOne('SELECT COUNT(*) FROM app_user'));
    }
}
