<?php

namespace App\Tests\Api;

use App\Connections\ConnectionsCrypto;
use App\Tests\ApiTestCase;

/**
 * Escenarios de "Conexiones por usuario", "Secretos cifrados en reposo",
 * "Secretos ilegibles se conservan", "Sincronización con revisión" y
 * "Validación de lo que se guarda".
 */
final class ConnectionsTest extends ApiTestCase
{
    private const string SSH_PASSWORD = 'contraseña-ssh-muy-secreta';

    public function testNewAccountHasAnEmptyList(): void
    {
        $token = $this->register()['token'];

        self::assertSame(['revision' => 0, 'entries' => []], $this->getJson('/api/connections', self::auth($token)));
    }

    public function testSavedListIsReadBackInOrderWithCredentials(): void
    {
        $token = $this->register()['token'];

        $saved = $this->putJson('/api/connections', ['revision' => 0, 'entries' => self::sampleEntries()], self::auth($token));
        self::assertResponseIsSuccessful();
        $read = $this->getJson('/api/connections', self::auth($token));

        self::assertSame($saved, $read);
        self::assertSame(1, $read['revision']);
        self::assertSame(['f1', 'ssh1', 's3new', 'legacy'], array_column($read['entries'], 'id'));
        self::assertSame(['id' => 'f1', 'name' => 'Trabajo', 'parentId' => null, 'isFolder' => true], $read['entries'][0]);
        self::assertEquals([
            'id' => 'ssh1', 'name' => 'Servidor', 'parentId' => 'f1', 'type' => 'ssh', 'host' => 'example.com', 'port' => 2222,
            'username' => 'root', 'authMethod' => 'password', 'password' => self::SSH_PASSWORD, 'initialPath' => '/srv',
        ], $read['entries'][1]);
        self::assertSame('SK-NEW', $read['entries'][2]['secretAccessKey']);
        // Entradas de versiones antiguas, sin tipo: S3
        self::assertSame('s3', $read['entries'][3]['type']);
        self::assertSame('AK-OLD', $read['entries'][3]['accessKeyId']);
    }

    public function testAccountsAreIsolatedEvenWithTheSameIds(): void
    {
        $ana = $this->register('ana@ejemplo.com')['token'];
        $luis = $this->register('luis@ejemplo.com')['token'];
        $this->putJson('/api/connections', ['revision' => 0, 'entries' => self::sampleEntries()], self::auth($ana));
        self::assertResponseIsSuccessful();

        $entry = ['id' => 'ssh1', 'name' => 'De Luis', 'type' => 'ssh', 'host' => 'luis.example', 'username' => 'luis', 'authMethod' => 'password'];
        $this->putJson('/api/connections', ['revision' => 0, 'entries' => [$entry]], self::auth($luis));
        self::assertResponseIsSuccessful();

        $anaList = $this->getJson('/api/connections', self::auth($ana));
        $luisList = $this->getJson('/api/connections', self::auth($luis));
        self::assertCount(4, $anaList['entries']);
        self::assertSame('Servidor', $anaList['entries'][1]['name']);
        self::assertSame(['ssh1'], array_column($luisList['entries'], 'id'));
        self::assertSame('De Luis', $luisList['entries'][0]['name']);
    }

    public function testSecretsAreNotStoredInPlainText(): void
    {
        $token = $this->register()['token'];
        $this->putJson('/api/connections', ['revision' => 0, 'entries' => self::sampleEntries()], self::auth($token));

        $rows = $this->db()->fetchAllAssociative('SELECT * FROM connection_entry');
        $dump = json_encode($rows, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);
        foreach ([self::SSH_PASSWORD, 'SK-NEW', 'AK-NEW', 'SK-OLD'] as $secret) {
            self::assertStringNotContainsString($secret, $dump);
        }
        $secrets = array_column($rows, 'secrets', 'id');
        self::assertNull($secrets['f1']);
        self::assertStringStartsWith('v1:', $secrets['ssh1']);
    }

    public function testUnchangedSecretsAreNotReencrypted(): void
    {
        $token = $this->register()['token'];
        $saved = $this->putJson('/api/connections', ['revision' => 0, 'entries' => self::sampleEntries()], self::auth($token));
        $before = $this->secretsById();

        $this->putJson('/api/connections', $saved, self::auth($token));

        self::assertResponseIsSuccessful();
        self::assertSame($before, $this->secretsById());
    }

    public function testConflictBetweenTwoDevices(): void
    {
        $this->register();
        $deviceA = $this->login(deviceName: 'A');
        $deviceB = $this->login(deviceName: 'B');
        $this->putJson('/api/connections', ['revision' => 0, 'entries' => self::sampleEntries()], self::auth($deviceA));
        $revision = $this->getJson('/api/connections', self::auth($deviceB))['revision'];

        $fromA = $this->putJson('/api/connections', ['revision' => $revision, 'entries' => [self::sampleEntries()[0]]], self::auth($deviceA));
        self::assertSame($revision + 1, $fromA['revision']);

        $conflict = $this->putJson('/api/connections', ['revision' => $revision, 'entries' => []], self::auth($deviceB));

        self::assertResponseStatusCodeSame(409);
        self::assertSame(['code' => 'connections_conflict'], $conflict['error']);
        self::assertSame($fromA['revision'], $conflict['revision']);
        self::assertSame($fromA['entries'], $conflict['entries']);
        self::assertSame(['revision' => $fromA['revision'], 'entries' => $fromA['entries']], $this->getJson('/api/connections', self::auth($deviceA)));
    }

    public function testInvalidListChangesNothing(): void
    {
        $token = $this->register()['token'];
        $saved = $this->putJson('/api/connections', ['revision' => 0, 'entries' => self::sampleEntries()], self::auth($token));

        $entries = [self::sampleEntries()[0], ['id' => 'x', 'name' => 'FTP', 'type' => 'ftp', 'host' => 'ftp.example']];
        $body = $this->putJson('/api/connections', ['revision' => 1, 'entries' => $entries], self::auth($token));

        self::assertResponseStatusCodeSame(400);
        self::assertSame(['code' => 'connections_invalid', 'details' => ['index' => 1, 'reason' => 'unknown_type', 'field' => 'type']], $body['error']);
        self::assertSame($saved, $this->getJson('/api/connections', self::auth($token)));
    }

    public function testRevisionIsRequired(): void
    {
        $token = $this->register()['token'];

        $body = $this->putJson('/api/connections', ['entries' => []], self::auth($token));

        self::assertResponseStatusCodeSame(400);
        self::assertSame(['code' => 'connections_invalid', 'details' => ['reason' => 'invalid_revision']], $body['error']);
    }

    public function testUnreadableSecretIsKeptUntilReplaced(): void
    {
        $token = $this->register()['token'];
        $this->putJson('/api/connections', ['revision' => 0, 'entries' => self::sampleEntries()], self::auth($token));
        // Como si se hubiera perdido la clave con la que se cifró
        $lost = new ConnectionsCrypto(base64_encode(random_bytes(32)));
        $unreadable = $lost->encrypt(['password' => self::SSH_PASSWORD]);
        $this->db()->executeStatement("UPDATE connection_entry SET secrets = ? WHERE id = 'ssh1'", [$unreadable]);

        $list = $this->getJson('/api/connections', self::auth($token));
        $ssh = $list['entries'][1];
        self::assertTrue($ssh['credentialsUnavailable']);
        self::assertSame('', $ssh['password']);
        self::assertSame('example.com', $ssh['host']);
        self::assertArrayNotHasKey('credentialsUnavailable', $list['entries'][2]);

        // Guardar otros cambios devolviendo la entrada tal cual no borra el secreto
        $list['entries'][0]['name'] = 'Trabajo (renombrada)';
        $saved = $this->putJson('/api/connections', $list, self::auth($token));
        self::assertResponseIsSuccessful();
        self::assertTrue($saved['entries'][1]['credentialsUnavailable']);
        self::assertSame($unreadable, $this->secretsById()['ssh1']);

        // Hasta que la persona introduce una contraseña nueva
        $entry = $saved['entries'][1];
        unset($entry['credentialsUnavailable']);
        $entry['password'] = 'nueva';
        $saved['entries'][1] = $entry;
        $final = $this->putJson('/api/connections', $saved, self::auth($token));
        self::assertArrayNotHasKey('credentialsUnavailable', $final['entries'][1]);
        self::assertSame('nueva', $final['entries'][1]['password']);
    }

    /** @return list<array<string, mixed>> */
    private static function sampleEntries(): array
    {
        return [
            ['id' => 'f1', 'name' => 'Trabajo', 'isFolder' => true, 'parentId' => null],
            ['id' => 'ssh1', 'name' => 'Servidor', 'parentId' => 'f1', 'type' => 'ssh', 'host' => 'example.com', 'port' => 2222, 'username' => 'root', 'authMethod' => 'password', 'password' => self::SSH_PASSWORD, 'initialPath' => '/srv'],
            ['id' => 's3new', 'name' => 'Backups', 'parentId' => 'f1', 'type' => 's3', 'endpoint' => 'https://s3.example.com', 'accessKeyId' => 'AK-NEW', 'secretAccessKey' => 'SK-NEW', 'bucket' => 'copias', 'region' => 'eu'],
            ['id' => 'legacy', 'name' => 'De la 0.0.7', 'endpoint' => 'https://old.example.com', 'accessKeyId' => 'AK-OLD', 'secretAccessKey' => 'SK-OLD'],
        ];
    }

    /** @return array<string, ?string> */
    private function secretsById(): array
    {
        return array_column($this->db()->fetchAllAssociative('SELECT id, secrets FROM connection_entry'), 'secrets', 'id');
    }
}
