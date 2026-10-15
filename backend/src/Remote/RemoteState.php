<?php

namespace App\Remote;

/** Si el equipo se puede controlar ahora, según lo que publica la app (add-remote-desktop D4). */
enum RemoteState: string
{
    case Disabled = 'disabled';
    case Available = 'available';
    case MissingPermissions = 'missing_permissions';
    case Unsupported = 'unsupported';
    case Busy = 'busy';

    /** Desactivado o imposible en ese sistema: no se le pasan solicitudes. */
    public function acceptsRequests(): bool
    {
        return self::Disabled !== $this && self::Unsupported !== $this;
    }
}
