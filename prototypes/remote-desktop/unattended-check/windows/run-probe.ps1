# Ejecutar solo en la VM de laboratorio, desde una carpeta nueva protegida para SYSTEM/Administradores.
# Usa el compilador incluido con PowerShell; no instala componentes ni cambia políticas.
param([string]$WorkingDirectory = $PSScriptRoot)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
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
[ordered]@{
    sourceSha256 = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
    binarySha256 = (Get-FileHash -LiteralPath $binary -Algorithm SHA256).Hash.ToLowerInvariant()
    runtimeVersion = [Environment]::Version.ToString()
    launcher = ($launcher | ConvertFrom-Json)
    capture = $result
    installedService = $false
    uacTested = $false
    inputTested = $false
    readyForUnattended = $false
} | ConvertTo-Json -Depth 5
