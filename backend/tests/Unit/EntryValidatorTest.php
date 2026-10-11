<?php

namespace App\Tests\Unit;

use App\Api\ApiException;
use App\Connections\EntryKind;
use App\Connections\EntryValidator;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class EntryValidatorTest extends TestCase
{
    private const array FOLDER = ['id' => 'f1', 'name' => 'Carpeta', 'isFolder' => true];
    private const array S3 = ['id' => 's3', 'name' => 'S3', 'type' => 's3', 'endpoint' => 'https://s3.test', 'accessKeyId' => 'AK', 'secretAccessKey' => 'SK'];
    private const array SSH = ['id' => 'ssh', 'name' => 'SSH', 'type' => 'ssh', 'host' => 'example.com', 'port' => 22, 'username' => 'root', 'authMethod' => 'password', 'password' => 'pw'];

    #[DataProvider('invalidLists')]
    public function testInvalidLists(mixed $entries, ?int $index, string $reason, ?string $field = null): void
    {
        try {
            (new EntryValidator())->validate($entries);
            self::fail('Se esperaba connections_invalid');
        } catch (ApiException $e) {
            self::assertSame('connections_invalid', $e->getErrorCode());
            self::assertSame(400, $e->getStatusCode());
            $expected = array_filter(['index' => $index, 'reason' => $reason, 'field' => $field], static fn ($v) => null !== $v);
            self::assertSame($expected, $e->getDetails());
        }
    }

    public static function invalidLists(): iterable
    {
        yield 'no es una lista' => [['a' => self::S3], null, 'not_a_list'];
        yield 'sin lista' => [null, null, 'not_a_list'];
        yield 'más de 1000 entradas' => [array_fill(0, 1001, self::FOLDER), null, 'too_many_entries'];
        yield 'entrada que no es objeto' => [[self::FOLDER, 'texto'], 1, 'not_an_object'];
        yield 'entrada que es una lista' => [[[1, 2]], 0, 'not_an_object'];
        yield 'tipo desconocido' => [[self::FOLDER, ['type' => 'ftp'] + self::SSH], 1, 'unknown_type', 'type'];
        yield 'tipo carpeta sin isFolder' => [[['type' => 'folder'] + self::SSH], 0, 'unknown_type', 'type'];
        yield 'sin id' => [[['name' => 'x', 'isFolder' => true]], 0, 'invalid_field', 'id'];
        yield 'id vacío' => [[['id' => '  '] + self::FOLDER], 0, 'invalid_field', 'id'];
        yield 'id de 65' => [[['id' => str_repeat('a', 65)] + self::FOLDER], 0, 'invalid_field', 'id'];
        yield 'id duplicado' => [[self::FOLDER, ['id' => 'f1'] + self::S3], 1, 'duplicate_id', 'id'];
        yield 'sin nombre' => [[['id' => 'x', 'isFolder' => true]], 0, 'invalid_field', 'name'];
        yield 'nombre enorme' => [[['name' => str_repeat('n', 1001)] + self::FOLDER], 0, 'invalid_field', 'name'];
        yield 's3 sin endpoint' => [[array_diff_key(self::S3, ['endpoint' => 1])], 0, 'invalid_field', 'endpoint'];
        yield 's3 sin secretAccessKey' => [[array_diff_key(self::S3, ['secretAccessKey' => 1])], 0, 'invalid_field', 'secretAccessKey'];
        yield 's3 con clave no texto' => [[['accessKeyId' => 42] + self::S3], 0, 'invalid_field', 'accessKeyId'];
        yield 'ssh sin host' => [[['host' => ' '] + self::SSH], 0, 'invalid_field', 'host'];
        yield 'ssh sin usuario' => [[array_diff_key(self::SSH, ['username' => 1])], 0, 'invalid_field', 'username'];
        yield 'puerto 0' => [[['port' => 0] + self::SSH], 0, 'invalid_field', 'port'];
        yield 'puerto 65536' => [[['port' => 65536] + self::SSH], 0, 'invalid_field', 'port'];
        yield 'puerto como texto' => [[['port' => '22'] + self::SSH], 0, 'invalid_field', 'port'];
        yield 'authMethod desconocido' => [[['authMethod' => 'kerberos'] + self::SSH], 0, 'invalid_field', 'authMethod'];
        yield 'clave privada sin ruta' => [[['authMethod' => 'privateKey'] + self::SSH], 0, 'invalid_field', 'privateKeyPath'];
        yield 'contraseña no texto' => [[['password' => ['x']] + self::SSH], 0, 'invalid_field', 'password'];
        yield 'secretos demasiado grandes' => [[['password' => str_repeat('p', 17000)] + self::SSH], 0, 'secrets_too_large'];
        yield 'campo extra anidado' => [[['extra' => ['a' => 1]] + self::SSH], 0, 'invalid_field', 'extra'];
        yield 'demasiados campos extra' => [[self::SSH + array_fill_keys(array_map(static fn ($i) => "x$i", range(1, 40)), 1)], 0, 'too_many_fields'];
        yield 'padre inexistente' => [[['parentId' => 'nope'] + self::S3], 0, 'invalid_parent', 'parentId'];
        yield 'padre que no es carpeta' => [[self::S3, ['parentId' => 's3'] + self::SSH], 1, 'invalid_parent', 'parentId'];
        yield 'carpeta dentro de sí misma' => [[['parentId' => 'f1'] + self::FOLDER], 0, 'invalid_parent', 'parentId'];
        yield 'ciclo entre carpetas' => [[['parentId' => 'f2'] + self::FOLDER, ['id' => 'f2', 'parentId' => 'f1'] + self::FOLDER], 0, 'invalid_parent', 'parentId'];
    }

    public function testLegacyEntryWithoutTypeIsS3(): void
    {
        $entries = (new EntryValidator())->validate([array_diff_key(self::S3, ['type' => 1])]);

        self::assertSame(EntryKind::S3, $entries[0]->kind);
        self::assertSame(['endpoint' => 'https://s3.test'], $entries[0]->data);
        self::assertSame(['accessKeyId' => 'AK', 'secretAccessKey' => 'SK'], $entries[0]->secrets);
    }

    public function testSshDefaultsAndSecretSeparation(): void
    {
        $raw = array_diff_key(self::SSH, ['port' => 1]) + ['passphrase' => '', 'initialPath' => '/home', '_encrypted' => true, 'isFolder' => false];

        $entry = (new EntryValidator())->validate([$raw])[0];

        self::assertSame(EntryKind::Ssh, $entry->kind);
        self::assertSame(['authMethod' => 'password', 'host' => 'example.com', 'initialPath' => '/home', 'port' => 22, 'username' => 'root'], $entry->data);
        // Un secreto vacío es "sin secreto"
        self::assertSame(['password' => 'pw'], $entry->secrets);
        self::assertFalse($entry->credentialsUnavailable);
    }

    public function testPrivateKeyKeepsOnlyThePath(): void
    {
        $raw = ['authMethod' => 'privateKey', 'privateKeyPath' => '~/.ssh/id_ed25519', 'passphrase' => 'frase'] + self::SSH;

        $entry = (new EntryValidator())->validate([$raw])[0];

        self::assertSame('~/.ssh/id_ed25519', $entry->data['privateKeyPath']);
        self::assertSame(['passphrase' => 'frase', 'password' => 'pw'], $entry->secrets);
    }

    public function testFolderKeepsOnlyItsOwnFields(): void
    {
        $entries = (new EntryValidator())->validate([self::FOLDER + ['parentId' => '', 'type' => 'ssh', 'host' => 'x'], ['parentId' => 'f1'] + self::S3]);

        self::assertSame(EntryKind::Folder, $entries[0]->kind);
        self::assertNull($entries[0]->parentId);
        self::assertSame([], $entries[0]->data);
        self::assertSame('f1', $entries[1]->parentId);
    }

    public function testUnknownScalarFieldsArePreserved(): void
    {
        $entry = (new EntryValidator())->validate([self::S3 + ['forcePathStyle' => true, 'note' => null]])[0];

        self::assertSame(['endpoint' => 'https://s3.test', 'forcePathStyle' => true, 'note' => null], $entry->data);
    }

    public function testCredentialsUnavailableFlag(): void
    {
        $entry = (new EntryValidator())->validate([['credentialsUnavailable' => true, 'password' => ''] + self::SSH])[0];

        self::assertTrue($entry->credentialsUnavailable);
        self::assertSame([], $entry->secrets);
        self::assertArrayNotHasKey('credentialsUnavailable', $entry->data);
    }

    public function testAThousandEntriesAreAllowed(): void
    {
        $entries = array_map(static fn (int $i) => ['id' => "f$i"] + self::FOLDER, range(1, EntryValidator::MAX_ENTRIES));

        self::assertCount(1000, (new EntryValidator())->validate($entries));
    }
}
