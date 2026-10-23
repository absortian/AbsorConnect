<?php

namespace App\HostAgent;

use App\Api\ApiException;

/** Capacidades declaradas por el agente instalado; ausente nunca significa disponible. */
final readonly class AgentInfo
{
    public const array CAPABILITIES = ['administration', 'login', 'secureAttention', 'restart'];

    public function __construct(public string $version, public array $capabilities)
    {
    }

    public static function fromJson(array $data): self
    {
        $version = $data['agentVersion'] ?? null;
        if (!\is_string($version) || !preg_match('/^[0-9A-Za-z.+-]{1,32}$/D', $version)) {
            throw new ApiException('agent_invalid', 400, ['field' => 'agentVersion']);
        }
        $values = \array_key_exists('capabilities', $data) ? $data['capabilities'] : [];
        if (!\is_array($values) || array_diff(array_keys($values), self::CAPABILITIES)) {
            throw new ApiException('agent_invalid', 400, ['field' => 'capabilities']);
        }
        $capabilities = [];
        foreach (self::CAPABILITIES as $name) {
            $value = \array_key_exists($name, $values) ? $values[$name] : false;
            if (!\is_bool($value)) {
                throw new ApiException('agent_invalid', 400, ['field' => "capabilities.$name"]);
            }
            $capabilities[$name] = $value;
        }

        return new self($version, $capabilities);
    }
}
