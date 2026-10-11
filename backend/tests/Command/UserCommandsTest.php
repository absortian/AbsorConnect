<?php

namespace App\Tests\Command;

use App\Tests\ApiTestCase;
use Symfony\Bundle\FrameworkBundle\Console\Application;
use Symfony\Component\Console\Tester\CommandTester;

/** Escenario "Restablecer una contraseña olvidada" y listado para soporte (D9). */
final class UserCommandsTest extends ApiTestCase
{
    public function testResetPasswordRevokesSessionsAndKeepsConnections(): void
    {
        $token = $this->register()['token'];
        $this->login();
        $this->putJson('/api/connections', ['revision' => 0, 'entries' => [
            ['id' => 'c1', 'name' => 'S3', 'type' => 's3', 'endpoint' => 'https://s3.test', 'accessKeyId' => 'AK', 'secretAccessKey' => 'SK'],
        ]], self::auth($token));

        $tester = $this->command('app:user:reset-password');
        $tester->execute(['email' => 'ANA@ejemplo.com']);

        $tester->assertCommandIsSuccessful();
        $output = trim($tester->getDisplay());
        $password = trim(substr($output, (int) strrpos($output, "\n")));
        self::assertMatchesRegularExpression('/^[A-Za-z0-9_-]{20}$/', $password);
        self::assertSame(0, (int) $this->db()->fetchOne('SELECT COUNT(*) FROM user_session'));
        $this->getJson('/api/me', self::auth($token));
        self::assertResponseStatusCodeSame(401);

        $newToken = $this->login(password: $password);
        $list = $this->getJson('/api/connections', self::auth($newToken));
        self::assertSame(['c1'], array_column($list['entries'], 'id'));
        self::assertSame('SK', $list['entries'][0]['secretAccessKey']);
    }

    public function testResetPasswordOfUnknownEmailFails(): void
    {
        $tester = $this->command('app:user:reset-password');

        self::assertSame(1, $tester->execute(['email' => 'nadie@ejemplo.com']));
        self::assertStringContainsString('nadie@ejemplo.com', $tester->getDisplay());
    }

    public function testListShowsCountsButNoSecrets(): void
    {
        $token = $this->register()['token'];
        $this->putJson('/api/connections', ['revision' => 0, 'entries' => [
            ['id' => 'f1', 'name' => 'Carpeta', 'isFolder' => true],
            ['id' => 'c1', 'name' => 'S3', 'parentId' => 'f1', 'type' => 's3', 'endpoint' => 'https://s3.test', 'accessKeyId' => 'AK-LIST', 'secretAccessKey' => 'SK-LIST'],
        ]], self::auth($token));

        $tester = $this->command('app:user:list');
        $tester->execute([]);

        $tester->assertCommandIsSuccessful();
        $display = $tester->getDisplay();
        self::assertMatchesRegularExpression('/ana@ejemplo\.com\s.*\s1\s+\|?\s*1\s/', $display);
        self::assertStringNotContainsString('SK-LIST', $display);
        self::assertStringNotContainsString('acs_', $display);
    }

    private function command(string $name): CommandTester
    {
        return new CommandTester((new Application(self::$kernel))->find($name));
    }
}
