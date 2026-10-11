<?php

namespace App\Api;

use Symfony\Component\HttpFoundation\Request;

final class JsonBody
{
    /** @return array<string, mixed> */
    public static function from(Request $request): array
    {
        $content = $request->getContent();
        if ('' === $content) {
            return [];
        }
        try {
            $data = json_decode($content, true, 32, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            throw new ApiException('invalid_json', 400);
        }
        // Un objeto JSON: una lista o un escalar no son un cuerpo válido
        if (!\is_array($data) || ([] !== $data && array_is_list($data))) {
            throw new ApiException('invalid_json', 400);
        }

        return $data;
    }
}
