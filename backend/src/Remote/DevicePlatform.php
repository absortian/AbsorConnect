<?php

namespace App\Remote;

/** Sistema de un equipo registrado (add-remote-desktop D4). */
enum DevicePlatform: string
{
    case Windows = 'windows';
    case Macos = 'macos';
    case Linux = 'linux';
}
