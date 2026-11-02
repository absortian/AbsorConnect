#!/usr/bin/env python3
"""Matriz DPAPI optativa y acotada; solo VM propia, sin captura, red API o entrada."""
import argparse
import hashlib
import importlib.util
import json
import re
import time
import uuid
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
ROOT = r'C:\ProgramData\AbsorConnectVaultLab'
BINARY = 'absor-win-vault-check-lab.exe'
MARKER = 'ABSOR_CONNECT_OWN_WINDOWS_VM_VAULT_V1\n'
FILE_ACL = 'O:SYG:SYD:P(A;;FA;;;SY)(A;;FA;;;BA)'
DIR_ACL = 'O:SYG:SYD:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)'


class LabError(Exception):
    pass


def require(ok, code):
    if not ok:
        raise LabError(code)


def module(path, name):
    require(path.is_file() and not path.is_symlink(), 'private_helper_missing')
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


class Matrix:
    def __init__(self, lab, artifact, reboot):
        self.lab = lab
        self.binary = artifact / BINARY
        require(self.binary.is_file() and not self.binary.is_symlink(), 'artifact_missing')
        require(0 < self.binary.stat().st_size < 20000000, 'artifact_size')
        self.digest = hashlib.sha256(self.binary.read_bytes()).hexdigest()
        meta = json.loads((artifact / 'build.json').read_text())
        require(meta.get('schema') == 1 and re.fullmatch('[0-9a-f]{40}', meta.get('commit', '')), 'artifact_metadata')
        require(meta.get('files') == {BINARY: self.digest}, 'artifact_hash')
        self.commit = meta['commit']
        self.remote = module(lab / 'windows-vm-ssh/lab_remote.py', 'vault_remote')
        self.qga = module(lab / 'windows-vm-ssh/qga_owned.py', 'vault_qga')
        self.out = lab / ('windows-vault-' + uuid.uuid4().hex)
        self.out.mkdir(mode=0o700)
        self.cases = []
        self.created = False
        self.removed = False
        self.reboot = reboot

    def save(self, name, value):
        p = self.out / name
        p.write_text(json.dumps(value, indent=2) + '\n')
        p.chmod(0o600)

    def system(self, source):
        value = self.qga.call("$d='" + ROOT + "';$s=$d+'\\store';" + source)
        if value.get('ok') is not True:
            self.save('system-failure.json', value)
            raise LabError('system_' + value.get('errorCode', 'failed'))
        return value['result']

    def ps(self, source):
        result = self.remote.powershell("$ErrorActionPreference='Stop';" + source)
        require(result.returncode == 0 and len(result.stdout) < 16384, 'ssh_command')
        try:
            return json.loads(result.stdout.decode('utf-8-sig'))
        except ValueError:
            raise LabError('ssh_json') from None

    def invoke(self, command, reason=None):
        require(command in ('provision', 'provision-four', 'read', 'commit', 'revoke', 'wrong-host', 'expect-denied', 'check-lock', 'fail-once'), 'command_enum')
        value = self.system("$raw=& ($d+'\\" + BINARY + "') '" + command + "';if($LASTEXITCODE -ne 0){throw 'native_failed'};$raw|ConvertFrom-Json")
        require(value.get('schema') == 1 and value.get('ok') is True and value.get('readyForUnattended') is False, 'native_report')
        if reason:
            require(value.get('denied') is True and value.get('reason') == reason, 'wrong_denial')
        if 'facts' in value:
            require(value['facts'] and all(v is True for v in value['facts'].values()), 'native_facts')
        return value

    def case(self, name, **facts):
        require(facts and all(v is True for v in facts.values()), 'case_' + name)
        self.cases.append({'case': name, 'ok': True, **facts})
        print(json.dumps({'case': name, 'ok': True}), flush=True)

    def hash(self):
        return self.system("@{hash=(Get-FileHash -LiteralPath ($s+'\\attempts.dpapi') -Algorithm SHA256).Hash.ToLowerInvariant()}")['hash']

    def acl(self, path, sddl, directory=False):
        kind = 'DirectorySecurity' if directory else 'FileSecurity'
        self.system("$a=New-Object Security.AccessControl." + kind + ";$a.SetSecurityDescriptorSddlForm('" + sddl + "');Set-Acl -LiteralPath (" + path + ") -AclObject $a;@{set=$true}")

    def prepare(self):
        self.system("$m=Get-CimInstance Win32_ComputerSystem;if($m.Manufacturer -cne 'QEMU' -or $m.Model -cne 'QEMU Virtual Machine' -or [Security.Principal.WindowsIdentity]::GetCurrent().User.Value -cne 'S-1-5-18'){throw 'own_system_vm_required'};if(Test-Path -LiteralPath $d){throw 'destination_exists'};New-Item -ItemType Directory -Path $d|Out-Null;$a=New-Object Security.AccessControl.DirectorySecurity;$a.SetSecurityDescriptorSddlForm('" + DIR_ACL + "');Set-Acl -LiteralPath $d -AclObject $a;[IO.File]::WriteAllText(($d+'\\lab-owner.txt'),\"ABSOR_CONNECT_OWN_WINDOWS_VM_VAULT_V1`n\",(New-Object Text.UTF8Encoding($false)));@{created=$true}")
        self.created = True
        result = self.remote.transfer(['put ' + str(self.binary) + ' /' + ROOT.replace('\\', '/') + '/' + BINARY])
        require(result.returncode == 0, 'artifact_transfer')
        result = self.remote.transfer(['put ' + str(REPO/'agent/windows-vault-lab/check-denials.ps1') + ' /' + ROOT.replace('\\', '/') + '/check-denials.ps1'])
        require(result.returncode == 0, 'denials_transfer')
        self.system("$a=New-Object Security.AccessControl.FileSecurity;$a.SetSecurityDescriptorSddlForm('" + FILE_ACL + "');foreach($n in @('lab-owner.txt','" + BINARY + "')){Set-Acl -LiteralPath ($d+'\\'+$n) -AclObject $a};if((Get-FileHash -LiteralPath ($d+'\\" + BINARY + "') -Algorithm SHA256).Hash.ToLowerInvariant() -cne '" + self.digest + "'){throw 'binary_hash'};@{verified=$true}")
        self.baseline = self.snapshot()
        require(not self.baseline['userLoggedOn'], 'login_screen_required')

    def snapshot(self):
        return self.ps("[ordered]@{userLoggedOn=[bool](Get-CimInstance Win32_ComputerSystem).UserName;uac=Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System'|Select-Object EnableLUA,PromptOnSecureDesktop,ConsentPromptBehaviorAdmin,ConsentPromptBehaviorUser;service=[bool](Get-Service AbsorConnectSessionLab -ErrorAction SilentlyContinue)}|ConvertTo-Json -Compress")

    def fault(self, name, prepare, restore, reason):
        old = self.hash()
        self.system(prepare + ';@{prepared=$true}')
        try:
            self.invoke('expect-denied', reason)
        finally:
            self.system(restore + ';@{restored=$true}')
        self.invoke('read')
        self.case(name, denied=True, counterUnchanged=self.hash() == old)

    def execute(self):
        self.prepare()
        value = self.invoke('provision')
        self.case('provision_without_login', noUser=True, nativeFacts=all(value['facts'].values()))
        self.invoke('read')
        self.invoke('check-lock')
        self.case('fresh_process_preserves_lock', nativeVerifierLocked=True)
        if self.reboot:
            result = self.remote.command('shutdown.exe /r /t 1',10)
            require(result.returncode == 0,'reboot_request')
            time.sleep(3)
            end = time.monotonic()+150
            while True:
                try:
                    state = self.snapshot()
                    if not state['userLoggedOn']:
                        self.invoke('check-lock')
                        break
                except (LabError,RuntimeError):
                    pass
                require(time.monotonic()<end,'reboot_timeout')
                time.sleep(2)
            self.case('reboot_without_user',nativeVerifierLocked=True,noUser=True)
        self.invoke('wrong-host')
        self.case('wrong_host', denied=True)
        old = self.hash()
        self.invoke('commit')
        self.invoke('read')
        self.case('replace_attempts', newCiphertext=self.hash() != old, statePreserved=True)
        other = self.ps("Add-Type -AssemblyName System.Security;try{$b=[IO.File]::ReadAllBytes('" + ROOT + "\\store\\credentials.dpapi');$e=[Text.Encoding]::UTF8.GetBytes(\"absorconnect-agent-windows-vault-v1`n11111111-2222-4333-8444-555555555555`ncredentials\");$plain=[Security.Cryptography.ProtectedData]::Unprotect($b,$e,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Array]::Clear($plain,0,$plain.Length);$denied=$false}catch [Security.Cryptography.CryptographicException]{$denied=$true};@{otherProfileDenied=$denied}|ConvertTo-Json -Compress")
        self.case('different_dpapi_profile', denied=other.get('otherProfileDenied') is True)
        denial_hash = hashlib.sha256((REPO/'agent/windows-vault-lab/check-denials.ps1').read_bytes()).hexdigest()
        denials = self.ps("$p='" + ROOT + "\\check-denials.ps1';if((Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant() -cne '"+denial_hash+"'){throw 'denials_hash'};Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force;& $p")
        self.save('restricted-user.json',denials)
        self.case('restricted_user_denials', allDenied=all(v is True for v in denials['denials'].values()), interactiveClaimAbsent=denials.get('standardInteractiveUserTested') is False)
        # Solo se conservan bytes cifrados de la propia sonda para restaurar cada fallo.
        backup = "$backup=$d+'\\attempts-backup.bin'"
        self.system(backup + ";[IO.File]::WriteAllBytes($backup,[IO.File]::ReadAllBytes($s+'\\attempts.dpapi'));@{saved=$true}")
        restore = backup + ";[IO.File]::WriteAllBytes(($s+'\\attempts.dpapi'),[IO.File]::ReadAllBytes($backup))"
        self.fault('ciphertext_tampered', "$p=$s+'\\attempts.dpapi';$b=[IO.File]::ReadAllBytes($p);$b[$b.Length-1]=$b[$b.Length-1] -bxor 1;[IO.File]::WriteAllBytes($p,$b)", restore, 'Crypto')
        self.fault('cross_purpose_blob', "[IO.File]::WriteAllBytes(($s+'\\attempts.dpapi'),[IO.File]::ReadAllBytes($s+'\\credentials.dpapi'))", restore, 'Crypto')
        self.fault('missing_attempts', "Remove-Item -LiteralPath ($s+'\\attempts.dpapi')", restore + ";$a=New-Object Security.AccessControl.FileSecurity;$a.SetSecurityDescriptorSddlForm('"+FILE_ACL+"');Set-Acl -LiteralPath ($s+'\\attempts.dpapi') -AclObject $a", 'Io')
        reset_acl = "$a=New-Object Security.AccessControl.FileSecurity;$a.SetSecurityDescriptorSddlForm('"+FILE_ACL+"');Set-Acl -LiteralPath ($s+'\\attempts.dpapi') -AclObject $a"
        self.fault('permissive_acl', "$a=Get-Acl -LiteralPath ($s+'\\attempts.dpapi');$a.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule('S-1-5-32-545','Read','Allow')));Set-Acl -LiteralPath ($s+'\\attempts.dpapi') -AclObject $a", reset_acl, 'Metadata')
        self.fault('wrong_owner', "$a=Get-Acl -LiteralPath ($s+'\\attempts.dpapi');$a.SetOwner((New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')));Set-Acl -LiteralPath ($s+'\\attempts.dpapi') -AclObject $a", reset_acl, 'Metadata')
        self.fault('unprotected_dacl', "$a=Get-Acl -LiteralPath ($s+'\\attempts.dpapi');$a.SetAccessRuleProtection($false,$true);Set-Acl -LiteralPath ($s+'\\attempts.dpapi') -AclObject $a", reset_acl, 'Metadata')
        self.fault('hardlink', "New-Item -ItemType HardLink -Path ($s+'\\extra.bin') -Target ($s+'\\attempts.dpapi')|Out-Null", "Remove-Item -LiteralPath ($s+'\\extra.bin')", 'Metadata')
        self.fault('symlink', "Move-Item -LiteralPath ($s+'\\attempts.dpapi') -Destination ($s+'\\original.bin');New-Item -ItemType SymbolicLink -Path ($s+'\\attempts.dpapi') -Target ($s+'\\original.bin')|Out-Null", "Remove-Item -LiteralPath ($s+'\\attempts.dpapi');Move-Item -LiteralPath ($s+'\\original.bin') -Destination ($s+'\\attempts.dpapi')", 'Metadata')
        self.fault('junction_ancestor', "Move-Item -LiteralPath $s -Destination ($d+'\\original-store');New-Item -ItemType Junction -Path $s -Target ($d+'\\original-store')|Out-Null", "[IO.Directory]::Delete($s);Move-Item -LiteralPath ($d+'\\original-store') -Destination $s", 'Metadata')
        self.fault('unfinished_write', "[IO.File]::WriteAllBytes(($s+'\\pending.dpapi'),[byte[]]@(0))", "Remove-Item -LiteralPath ($s+'\\pending.dpapi')", 'Incomplete')
        self.fault('oversized_file', "[IO.File]::WriteAllBytes(($s+'\\attempts.dpapi'),(New-Object byte[] 16385))", restore, 'Metadata')
        self.invoke('revoke')
        self.invoke('expect-denied', 'Revoked')
        self.system(restore + ';@{restored=$true}')
        self.invoke('expect-denied', 'Revoked')
        self.case('revocation_survives_counter_restore', denied=True, freshProcess=True)
        # Segunda alta explícita SOLO del fixture: elimina su propio almacén completo.
        self.system("foreach($f in Get-ChildItem -LiteralPath $s -Force){if($f.PSIsContainer -or ($f.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $f.Name -notin @('broker.lock','credentials.dpapi','attempts.dpapi','ready.dpapi','revoked.dpapi')){throw 'foreign_store_file'};Remove-Item -LiteralPath $f.FullName};Remove-Item -LiteralPath $s;@{fixtureRetired=$true}")
        self.invoke('provision-four')
        self.invoke('fail-once')
        self.invoke('check-lock')
        self.invoke('read')
        self.case('fifth_failure_durable', nativeVerifierLocked=True, newProcess=True)
        final = self.snapshot()
        self.case('system_unchanged', noUser=not final['userLoggedOn'], sameUac=final['uac'] == self.baseline['uac'], noServiceChange=final['service'] == self.baseline['service'])

    def cleanup(self):
        if not self.created:
            return
        self.system("if([IO.File]::ReadAllText($d+'\\lab-owner.txt') -cne \"ABSOR_CONNECT_OWN_WINDOWS_VM_VAULT_V1`n\"){throw 'cleanup_marker'};$allowed=@('lab-owner.txt','"+BINARY+"','check-denials.ps1','attempts-backup.bin','store');foreach($f in Get-ChildItem -LiteralPath $d -Force){if($f.Name -notin $allowed -or ($f.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'cleanup_foreign_entry'};if($f.PSIsContainer){if($f.Name -cne 'store'){throw 'cleanup_foreign_directory'};foreach($n in Get-ChildItem -LiteralPath $f.FullName -Force){if($n.PSIsContainer -or ($n.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $n.Name -notin @('broker.lock','credentials.dpapi','attempts.dpapi','ready.dpapi','revoked.dpapi','pending.dpapi')){throw 'cleanup_foreign_file'};Remove-Item -LiteralPath $n.FullName};Remove-Item -LiteralPath $f.FullName}else{Remove-Item -LiteralPath $f.FullName}};Remove-Item -LiteralPath $d;@{removed=$true}")
        self.removed = True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('lab', type=Path)
    parser.add_argument('artifact', type=Path)
    parser.add_argument('--reboot', action='store_true')
    args = parser.parse_args()
    matrix = Matrix(args.lab.resolve(), args.artifact.resolve(), args.reboot)
    error = None
    started = time.monotonic()
    try:
        matrix.execute()
    except (LabError, RuntimeError) as exc:
        error = str(exc) if re.fullmatch('[a-z_]{1,100}', str(exc)) else 'non_enum_error'
    finally:
        try:
            matrix.cleanup()
        except (LabError, RuntimeError):
            error = error or 'cleanup_failed'
    report = {'schema': 1, 'ok': error is None, 'artifactCommit': matrix.commit, 'artifactSha256': matrix.digest, 'cases': matrix.cases, 'error': error, 'filesRemoved': matrix.removed, 'elapsedSeconds': round(time.monotonic()-started), 'captureTested': False, 'inputTested': False, 'readyForUnattended': False}
    matrix.save('report.json', report)
    print(json.dumps({'report': str(matrix.out/'report.json'), 'ok': error is None}))
    return 0 if error is None else 1


if __name__ == '__main__':
    raise SystemExit(main())
