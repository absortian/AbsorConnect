# Ejecutar solo en la VM de laboratorio, desde una carpeta nueva protegida para SYSTEM/Administradores.
# Usa el compilador incluido con PowerShell; no instala componentes ni cambia políticas.
param([string]$WorkingDirectory = $PSScriptRoot, [switch]$TestUacInput, [switch]$TestOwnedInput, [switch]$TestElevatedInput, [switch]$TestLockEscape)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if ($TestLockEscape -and ($TestUacInput -or $TestOwnedInput -or $TestElevatedInput)) {
    throw 'lock_probe_requires_exclusive_mode'
}
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
if ([Security.Principal.WindowsIdentity]::GetCurrent().User.Value -ne 'S-1-5-18') {
    throw 'system_context_required'
}
$directory = Get-Item -LiteralPath $WorkingDirectory
if (($directory.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'reparse_directory_rejected'
}
$acl = Get-Acl -LiteralPath $WorkingDirectory
if (-not $acl.AreAccessRulesProtected) { throw 'protected_directory_required' }
$allowed = @('S-1-5-18', 'S-1-5-32-544')
if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin $allowed) {
    throw 'protected_owner_required'
}
$writeRights = [Security.AccessControl.FileSystemRights]'Write,Delete,DeleteSubdirectoriesAndFiles,ChangePermissions,TakeOwnership'
foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
    if ($rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and
        ($rule.FileSystemRights -band $writeRights) -ne 0 -and
        $rule.IdentityReference.Value -notin $allowed) { throw 'untrusted_directory_writer' }
}
$source = Join-Path $WorkingDirectory 'CaptureProbe.cs'
$binary = Join-Path $WorkingDirectory 'CaptureProbe.exe'
$report = Join-Path $WorkingDirectory 'capture-report.json'
if ($TestUacInput -or $TestOwnedInput -or $TestElevatedInput -or $TestLockEscape) {
    if ((Get-CimInstance Win32_ComputerSystem).Manufacturer -ne 'QEMU') { throw 'qemu_lab_required' }
    if (Get-Process -Name CaptureProbe -ErrorAction SilentlyContinue) { throw 'another_probe_is_running' }
    if (Test-Path -LiteralPath (Join-Path $WorkingDirectory 'uac-input-report.json')) { throw 'input_output_exists' }
}
if ($TestElevatedInput -and ((Test-Path -LiteralPath (Join-Path $WorkingDirectory 'elevated-input-report.json')) -or
    (Test-Path -LiteralPath (Join-Path $WorkingDirectory 'elevated-target-report.json')))) { throw 'elevated_output_exists' }
if ($TestLockEscape -and (Test-Path -LiteralPath (Join-Path $WorkingDirectory 'lock-escape-report.json'))) { throw 'lock_output_exists' }
if ((Test-Path -LiteralPath $binary) -or (Test-Path -LiteralPath $report)) { throw 'output_exists' }
if (((Get-Item -LiteralPath $source).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'reparse_source_rejected'
}
Add-Type -TypeDefinition (Get-Content -LiteralPath $source -Raw) -OutputAssembly $binary -OutputType ConsoleApplication
$launcher = & $binary --launch-console-probe
if ($LASTEXITCODE -ne 0) { throw ('worker_failed_' + $LASTEXITCODE) }
$result = Get-Content -LiteralPath $report -Raw | ConvertFrom-Json
if ($result.frames -lt 1 -or $result.sessionId -eq 0 -or $result.readyForUnattended) {
    throw 'invalid_capture_result'
}
$inputResult = $null
if ($TestUacInput) {
    $inputLauncher = & $binary --launch-uac-input-probe
    $inputExitCode = $LASTEXITCODE
    $inputResult = Get-Content -LiteralPath (Join-Path $WorkingDirectory 'uac-input-report.json') -Raw | ConvertFrom-Json
    if ($inputExitCode -ne 0 -or -not $inputResult.secureDesktopEscapeTested -or
        $inputResult.requesterExitCode -ne 1223 -or $inputResult.escapeEventsInserted -ne 2 -or
        $inputResult.capture.desktop -ne 'Winlogon' -or $inputResult.readyForUnattended) {
        $inputResult | ConvertTo-Json -Depth 5
        throw ('uac_input_probe_failed_' + $inputExitCode)
    }
}
$ownedResults = @()
if ($TestOwnedInput) {
    foreach ($profile in @('user', 'system')) {
        $ownedLauncher = & $binary ('--launch-' + $profile + '-owned-input-probe')
        $ownedExitCode = $LASTEXITCODE
        $ownedDetails = ($ownedLauncher -join "`n") | ConvertFrom-Json
        if ($ownedExitCode -ne 0 -or -not $ownedDetails.workerExited -or
            $ownedDetails.workerExitCode -ne 0 -or $ownedDetails.sessionId -eq 0) {
            throw ('owned_input_probe_failed_' + $profile + '_' + $ownedExitCode)
        }
        # El trabajador solo devuelve cero tras observar recepción y restauración, no solo SendInput.
        $ownedResults += [ordered]@{
            profile = $profile
            launcher = $ownedDetails
            resultSource = 'worker_exit_after_fixed_native_assertions'
            mouseDownUpReceived = $true
            unicodeCharacterReceived = $true
            keyDownUpReceived = $true
            cursorRestored = $true
            target = 'own_window_same_process'
            separateElevatedApplicationTested = $false
            readyForUnattended = $false
        }
    }
}
$elevatedResult = $null
$elevatedTarget = $null
if ($TestElevatedInput) {
    $elevatedLauncher = & $binary --launch-elevated-input-probe
    $elevatedExitCode = $LASTEXITCODE
    if ($elevatedExitCode -ne 0) { throw ('elevated_input_probe_failed_' + $elevatedExitCode) }
    $elevatedResult = Get-Content -LiteralPath (Join-Path $WorkingDirectory 'elevated-input-report.json') -Raw | ConvertFrom-Json
    $elevatedTarget = Get-Content -LiteralPath (Join-Path $WorkingDirectory 'elevated-target-report.json') -Raw | ConvertFrom-Json
    if (-not $elevatedResult.separateProcesses -or -not $elevatedResult.senderSystem -or
        -not $elevatedResult.targetFullHighIntegrityUser -or -not $elevatedResult.cursorRestored -or
        $elevatedResult.receiverExitCode -ne 0 -or $elevatedResult.senderProcessId -eq $elevatedTarget.processId -or
        $elevatedResult.receiverProcessId -ne $elevatedTarget.processId -or
        $elevatedResult.sessionId -ne $elevatedTarget.sessionId -or
        -not $elevatedTarget.highIntegrity -or -not $elevatedTarget.fullElevationToken -or $elevatedTarget.system -or
        $elevatedTarget.mouseDown -ne 1 -or $elevatedTarget.mouseUp -ne 1 -or
        $elevatedTarget.keyDown -ne 1 -or $elevatedTarget.keyUp -ne 1 -or $elevatedTarget.characters -ne 1) {
        throw 'invalid_elevated_input_result'
    }
}
$lockResult = $null
if ($TestLockEscape) {
    if ($result.desktop -ne 'Winlogon') { throw 'winlogon_capture_required' }
    $lockLauncher = & $binary --launch-lock-escape-probe
    $lockCode = $LASTEXITCODE
    if ($lockCode -ne 0) { throw ('lock_escape_failed_' + $lockCode) }
    $lockResult = Get-Content -LiteralPath (Join-Path $WorkingDirectory 'lock-escape-report.json') -Raw | ConvertFrom-Json
    if ($lockResult.desktop -ne 'Winlogon' -or $lockResult.foregroundKind -ne 'logon' -or
        $lockResult.eventsInserted -ne 2 -or $lockResult.sessionId -eq 0) { throw 'invalid_lock_escape_result' }
}
[ordered]@{
    sourceSha256 = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
    binarySha256 = (Get-FileHash -LiteralPath $binary -Algorithm SHA256).Hash.ToLowerInvariant()
    runtimeVersion = [Environment]::Version.ToString()
    launcher = ($launcher | ConvertFrom-Json)
    capture = $result
    uacInput = $inputResult
    ownedInput = $ownedResults
    elevatedInput = $elevatedResult
    elevatedTarget = $elevatedTarget
    lockEscape = $lockResult
    lockEscapeReceptionRequiresVisualObservation = [bool]$TestLockEscape
    installedService = $false
    uacTested = [bool]$TestUacInput
    inputTested = [bool]($TestUacInput -or $TestOwnedInput -or $TestElevatedInput -or $TestLockEscape)
    readyForUnattended = $false
} | ConvertTo-Json -Depth 5
