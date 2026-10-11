<?php

namespace App\Connections;

use App\Api\ApiException;

/**
 * Port de normalizeEntry (src/shared/connections.ts) más los límites del
 * servicio. Cualquier entrada no reconocible rechaza el guardado entero con
 * `connections_invalid` y `details: {index, reason, field?}`.
 */
final class EntryValidator
{
    public const int MAX_ENTRIES = 1000;
    private const int MAX_ID_LENGTH = 64;
    private const int MAX_TEXT_LENGTH = 1000;
    private const int MAX_DATA_FIELDS = 32;
    private const int MAX_SECRETS_BYTES = 16384;
    private const int DEFAULT_SSH_PORT = 22;

    /** No van a `data`: tienen columna propia o solo existen en el cliente. */
    private const array RESERVED_FIELDS = ['id', 'name', 'parentId', 'isFolder', 'type', '_encrypted', 'credentialsUnavailable'];

    /** @return list<ValidEntry> en el orden recibido */
    public function validate(mixed $entries): array
    {
        if (!\is_array($entries) || !array_is_list($entries)) {
            throw self::invalid(null, 'not_a_list');
        }
        if (\count($entries) > self::MAX_ENTRIES) {
            throw self::invalid(null, 'too_many_entries');
        }

        $valid = [];
        $byId = [];
        foreach ($entries as $index => $raw) {
            $entry = $this->entry($index, $raw);
            if (isset($byId[$entry->id])) {
                throw self::invalid($index, 'duplicate_id', 'id');
            }
            $byId[$entry->id] = $entry;
            $valid[] = $entry;
        }
        self::checkParents($valid, $byId);

        return $valid;
    }

    private function entry(int $index, mixed $raw): ValidEntry
    {
        if (!\is_array($raw) || ([] !== $raw && array_is_list($raw))) {
            throw self::invalid($index, 'not_an_object');
        }

        $id = $raw['id'] ?? null;
        if (!\is_string($id) || '' === trim($id) || mb_strlen($id) > self::MAX_ID_LENGTH) {
            throw self::invalid($index, 'invalid_field', 'id');
        }
        $name = self::text($index, $raw, 'name', required: true);
        $parentId = $raw['parentId'] ?? null;
        if ('' === $parentId) {
            $parentId = null; // raíz, como `!c.parentId` en la barra lateral
        }
        if (null !== $parentId && (!\is_string($parentId) || mb_strlen($parentId) > self::MAX_ID_LENGTH)) {
            throw self::invalid($index, 'invalid_field', 'parentId');
        }

        if (true === ($raw['isFolder'] ?? null)) {
            return new ValidEntry($id, $name, $parentId, EntryKind::Folder, [], [], false);
        }

        // Las entradas sin tipo (versiones ≤ 0.0.7) son S3
        $type = $raw['type'] ?? EntryKind::S3->value;
        $kind = \is_string($type) ? EntryKind::tryFrom($type) : null;
        if (null === $kind || EntryKind::Folder === $kind) {
            throw self::invalid($index, 'unknown_type', 'type');
        }

        $data = EntryKind::S3 === $kind ? self::s3($index, $raw) : self::ssh($index, $raw);
        $secrets = self::secrets($index, $raw, $kind);
        // Campos que la app no conoce hoy: se conservan, como hace normalizeEntry
        foreach ($raw as $field => $value) {
            if (\in_array($field, self::RESERVED_FIELDS, true) || \in_array($field, $kind->secretFields(), true) || \array_key_exists($field, $data)) {
                continue;
            }
            if (!\is_string($field) || mb_strlen($field) > self::MAX_ID_LENGTH || \is_array($value) || (\is_string($value) && mb_strlen($value) > self::MAX_TEXT_LENGTH)) {
                throw self::invalid($index, 'invalid_field', (string) $field);
            }
            $data[$field] = $value;
        }
        if (\count($data) > self::MAX_DATA_FIELDS) {
            throw self::invalid($index, 'too_many_fields');
        }
        ksort($data);

        return new ValidEntry($id, $name, $parentId, $kind, $data, $secrets, true === ($raw['credentialsUnavailable'] ?? null));
    }

    /**
     * @param array<string, mixed> $raw
     *
     * @return array<string, scalar|null>
     */
    private static function s3(int $index, array $raw): array
    {
        $data = ['endpoint' => self::text($index, $raw, 'endpoint', required: true)];
        foreach (['bucket', 'region'] as $field) {
            if (null !== ($raw[$field] ?? null)) {
                $data[$field] = self::text($index, $raw, $field);
            }
        }
        // Obligatorios aunque vayan vacíos (credenciales no disponibles)
        foreach (EntryKind::S3->secretFields() as $field) {
            if (!\is_string($raw[$field] ?? null)) {
                throw self::invalid($index, 'invalid_field', $field);
            }
        }

        return $data;
    }

    /**
     * @param array<string, mixed> $raw
     *
     * @return array<string, scalar|null>
     */
    private static function ssh(int $index, array $raw): array
    {
        $data = [
            'host' => self::text($index, $raw, 'host', required: true, allowEmpty: false),
            'username' => self::text($index, $raw, 'username', required: true, allowEmpty: false),
        ];
        $port = $raw['port'] ?? self::DEFAULT_SSH_PORT;
        if (!\is_int($port) || $port < 1 || $port > 65535) {
            throw self::invalid($index, 'invalid_field', 'port');
        }
        $data['port'] = $port;
        $authMethod = $raw['authMethod'] ?? null;
        if ('password' !== $authMethod && 'privateKey' !== $authMethod) {
            throw self::invalid($index, 'invalid_field', 'authMethod');
        }
        $data['authMethod'] = $authMethod;
        // De la clave privada solo se guarda la ruta, nunca su contenido
        if ('privateKey' === $authMethod) {
            $data['privateKeyPath'] = self::text($index, $raw, 'privateKeyPath', required: true, allowEmpty: false);
        } elseif (null !== ($raw['privateKeyPath'] ?? null)) {
            $data['privateKeyPath'] = self::text($index, $raw, 'privateKeyPath');
        }
        if (null !== ($raw['initialPath'] ?? null)) {
            $data['initialPath'] = self::text($index, $raw, 'initialPath');
        }

        return $data;
    }

    /**
     * @param array<string, mixed> $raw
     *
     * @return array<string, string> solo los no vacíos: uno vacío es "sin secreto"
     */
    private static function secrets(int $index, array $raw, EntryKind $kind): array
    {
        $secrets = [];
        foreach ($kind->secretFields() as $field) {
            $value = $raw[$field] ?? null;
            if (null === $value) {
                continue;
            }
            if (!\is_string($value)) {
                throw self::invalid($index, 'invalid_field', $field);
            }
            if ('' !== $value) {
                $secrets[$field] = $value;
            }
        }
        if (\strlen(json_encode($secrets, JSON_THROW_ON_ERROR)) > self::MAX_SECRETS_BYTES) {
            throw self::invalid($index, 'secrets_too_large');
        }
        ksort($secrets);

        return $secrets;
    }

    /** @param array<string, mixed> $raw */
    private static function text(int $index, array $raw, string $field, bool $required = false, bool $allowEmpty = true): string
    {
        $value = $raw[$field] ?? null;
        if (null === $value && !$required) {
            return '';
        }
        if (!\is_string($value) || (!$allowEmpty && '' === trim($value)) || mb_strlen($value) > self::MAX_TEXT_LENGTH) {
            throw self::invalid($index, 'invalid_field', $field);
        }

        return $value;
    }

    /**
     * Cada parentId apunta a una carpeta de la misma lista, sin ciclos: si no,
     * la entrada quedaría fuera del árbol de la barra lateral.
     *
     * @param list<ValidEntry>          $entries
     * @param array<string, ValidEntry> $byId
     */
    private static function checkParents(array $entries, array $byId): void
    {
        foreach ($entries as $index => $entry) {
            if (null === $entry->parentId) {
                continue;
            }
            $parent = $byId[$entry->parentId] ?? null;
            if (null === $parent || EntryKind::Folder !== $parent->kind) {
                throw self::invalid($index, 'invalid_parent', 'parentId');
            }
        }
        foreach ($entries as $index => $entry) {
            $seen = [];
            for ($current = $entry; null !== $current->parentId; $current = $byId[$current->parentId]) {
                if (isset($seen[$current->id])) {
                    throw self::invalid($index, 'invalid_parent', 'parentId');
                }
                $seen[$current->id] = true;
            }
        }
    }

    private static function invalid(?int $index, string $reason, ?string $field = null): ApiException
    {
        $details = array_filter(['index' => $index, 'reason' => $reason, 'field' => $field], static fn ($v) => null !== $v);

        return new ApiException('connections_invalid', 400, $details);
    }
}
