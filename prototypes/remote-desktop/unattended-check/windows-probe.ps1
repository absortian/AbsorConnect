# Inventario de solo lectura. No instala servicios, no cambia UAC y no inyecta entrada.
$ErrorActionPreference = 'Stop'
$osInfo = Get-CimInstance -ClassName Win32_OperatingSystem
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
$policy = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System'
$diskState = 'not_checked'
try {
    if (Get-Command Get-BitLockerVolume -ErrorAction SilentlyContinue) {
        $diskState = [string](Get-BitLockerVolume -MountPoint $env:SystemDrive).ProtectionStatus
    }
} catch {
    $diskState = 'requires_permission'
}
[ordered]@{
    schema = 1
    platform = 'windows'
    osVersion = [string]$osInfo.Version
    buildNumber = [string]$osInfo.BuildNumber
    architecture = [string]$osInfo.OSArchitecture
    processSessionId = [Diagnostics.Process]::GetCurrentProcess().SessionId
    elevated = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    uacEnabled = ($policy.EnableLUA -eq 1)
    secureDesktopEnabled = ($policy.PromptOnSecureDesktop -eq 1)
    systemVolumeProtection = $diskState
    captureTested = $false
    inputTested = $false
    preLoginTested = $false
    readyForUnattended = $false
    status = 'probe_only_not_certified'
} | ConvertTo-Json
