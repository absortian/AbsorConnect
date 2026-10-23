# Precondición de pruebas, solo para una VM QEMU de laboratorio. Sin -Apply solo consulta.
# Activa UAC; nunca lo desactiva ni modifica el escritorio seguro o las solicitudes de credenciales.
param([switch]$Apply, [switch]$Restart)
$ErrorActionPreference = 'Stop'
$computer = Get-CimInstance Win32_ComputerSystem
if (($computer.Manufacturer + ' ' + $computer.Model) -notmatch 'QEMU') { throw 'qemu_lab_required' }
if (-not [Environment]::Is64BitProcess) { throw 'native_64bit_powershell_required' }
$path = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System'
$policy = Get-ItemProperty -LiteralPath $path
if ($null -eq $policy.EnableLUA -or $policy.PromptOnSecureDesktop -ne 1) {
    throw 'unexpected_uac_policy_review_required'
}
if ($Restart -and -not $Apply) { throw 'restart_requires_apply' }
if ($Apply) {
    if ([Security.Principal.WindowsIdentity]::GetCurrent().User.Value -ne 'S-1-5-18') {
        throw 'authorized_system_context_required'
    }
    Set-ItemProperty -LiteralPath $path -Name EnableLUA -Type DWord -Value 1
}
[ordered]@{
    schema = 1
    previousEnableLUA = [int]$policy.EnableLUA
    targetEnableLUA = 1
    secureDesktopEnabled = $true
    applied = [bool]$Apply
    restartRequested = [bool]$Restart
    uacTested = $false
} | ConvertTo-Json
if ($Restart) {
    # Sin /f: no forzar el cierre de aplicaciones con trabajo pendiente.
    & "$env:SystemRoot\System32\shutdown.exe" /r /t 0
    if ($LASTEXITCODE -ne 0) { throw 'normal_restart_rejected' }
}
