<?php

namespace App\Connections;

enum EntryKind: string
{
    case Folder = 'folder';
    case S3 = 's3';
    case Ssh = 'ssh';

    /**
     * Campos que se guardan cifrados: los mismos que SECRET_FIELDS en la app
     * (src/shared/connections.ts).
     *
     * @return list<string>
     */
    public function secretFields(): array
    {
        return match ($this) {
            self::Folder => [],
            self::S3 => ['accessKeyId', 'secretAccessKey'],
            self::Ssh => ['password', 'passphrase'],
        };
    }
}
