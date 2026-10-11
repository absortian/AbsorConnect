<?php

namespace App\Connections;

/** Entrada de la lista ya validada, separada en columnas, datos y secretos. */
final readonly class ValidEntry
{
    /**
     * @param array<string, scalar|null> $data    campos no secretos, con las claves ordenadas
     * @param array<string, string>      $secrets secretos no vacíos, con las claves ordenadas
     */
    public function __construct(
        public string $id,
        public string $name,
        public ?string $parentId,
        public EntryKind $kind,
        public array $data,
        public array $secrets,
        public bool $credentialsUnavailable,
    ) {
    }
}
