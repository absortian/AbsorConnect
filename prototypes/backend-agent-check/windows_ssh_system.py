#!/usr/bin/env python3
"""Runner administrativo exclusivo de VM: SSH fijado y tareas SYSTEM sin interfaz.

No es IPC del producto. Solo recibe código local de los arneses autorizados;
no abre puertos, no instala servicios y no usa UTM ni credenciales de usuario.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import shlex
import shutil
import uuid

BASE = r'C:\ProgramData\AbsorConnectLabSsh'
PREFIX = 'AbsorConnectLabQuiet-'
ACL = 'O:BAG:BAD:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)'

COMMON = r'''
$ErrorActionPreference='Stop'
function Assert-OwnVm {
 $m=Get-CimInstance Win32_ComputerSystem
 if($m.Manufacturer -cne 'QEMU' -or $m.Model -cne 'QEMU Virtual Machine'){throw 'own_vm_required'}
 if(-not([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'administrator_required'}
}
function Assert-PrivateDirectory([string]$p) {
 $i=Get-Item -LiteralPath $p -Force
 if(-not $i.PSIsContainer -or ($i.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'runner_directory_type'}
 $a=Get-Acl -LiteralPath $p
 if(-not $a.AreAccessRulesProtected){throw 'runner_directory_inheritance'}
 $owner=$a.GetOwner([Security.Principal.SecurityIdentifier]).Value
 if($owner -notin @('S-1-5-18','S-1-5-32-544',[Security.Principal.WindowsIdentity]::GetCurrent().User.Value)){throw 'runner_directory_owner'}
 $rules=@($a.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
 if($rules.Count -ne 2){throw 'runner_directory_acl_count'}
 $seen=@{}
 foreach($r in $rules){
  $sid=$r.IdentityReference.Value
  if($r.AccessControlType -ne 'Allow' -or $sid -notin @('S-1-5-18','S-1-5-32-544') -or $seen.ContainsKey($sid) -or $r.FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl){throw 'runner_directory_acl'}
  $seen[$sid]=$true
 }
}
function Assert-Runner {
 Assert-OwnVm
 Assert-PrivateDirectory 'C:\ProgramData\AbsorConnectLabSsh'
 Assert-PrivateDirectory $root
 $m=Get-Item -LiteralPath ($root+'\owner.txt') -Force
 if($m.PSIsContainer -or ($m.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $m.Length -gt 128 -or [IO.File]::ReadAllText($m.FullName) -cne ('absorconnect-quiet-system-v1 '+$nonce)){throw 'runner_marker'}
}
'''


def owned_ci_common():
    """Solo un runner efímero de GitHub; no habilita esa excepción en el Mac/VM propia."""
    host=os.environ.get('COMPUTERNAME','')
    if os.name!='nt' or os.environ.get('GITHUB_ACTIONS')!='true' or os.environ.get('RUNNER_ENVIRONMENT')!='github-hosted' or not re.fullmatch('[A-Za-z0-9-]{1,63}',host):
        raise RuntimeError('owned_ci_required')
    guard="function Assert-OwnVm {\n if($env:COMPUTERNAME -cne '"+host+"'){throw 'owned_ci_host_changed'}\n $m=Get-CimInstance Win32_ComputerSystem\n if($m.Manufacturer -cne 'Microsoft Corporation' -or $m.Model -cne 'Virtual Machine'){throw 'owned_ci_machine_required'}\n if(-not([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'administrator_required'}\n}\n"
    start=COMMON.index('function Assert-OwnVm {')
    end=COMMON.index('function Assert-PrivateDirectory')
    return COMMON[:start]+guard+COMMON[end:]

CONTROLLER = COMMON + r'''
Assert-Runner
$payload=$root+'\payload.ps1'
$i=Get-Item -LiteralPath $payload -Force
if($i.PSIsContainer -or ($i.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $i.Length -gt 24576 -or (Get-FileHash -LiteralPath $payload -Algorithm SHA256).Hash.ToLowerInvariant() -cne $payloadHash){throw 'runner_payload_hash'}
$taskName='AbsorConnectLabQuiet-'+$nonce
$description='AbsorConnect own VM quiet diagnostic v1 '+$nonce
$scheduler=New-Object -ComObject Schedule.Service
$scheduler.Connect()
$folder=$scheduler.GetFolder('\')
if(@($folder.GetTasks(1)|Where-Object {$_.Name -ceq $taskName}).Count -ne 0){throw 'runner_task_collision'}
$definition=$scheduler.NewTask(0)
$definition.RegistrationInfo.Description=$description
$definition.RegistrationInfo.Author='AbsorConnect Lab'
$systemName=(New-Object Security.Principal.SecurityIdentifier('S-1-5-18')).Translate([Security.Principal.NTAccount]).Value
$definition.Principal.UserId=$systemName
$definition.Principal.LogonType=5
$definition.Principal.RunLevel=1
$definition.Settings.Enabled=$true
$definition.Settings.AllowDemandStart=$true
$definition.Settings.MultipleInstances=2
$definition.Settings.ExecutionTimeLimit='PT30S'
$definition.Settings.DisallowStartIfOnBatteries=$false
$definition.Settings.StopIfGoingOnBatteries=$false
$definition.Settings.Hidden=$false
$action=$definition.Actions.Create(0)
$action.Path='C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
$action.Arguments='-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+$payload+'"'
$action.WorkingDirectory='C:\Windows\System32'
$registered=$false
$raw=$null
$cleanup=$false
try {
 # CREATE | DONT_ADD_PRINCIPAL_ACE: no sustitución ni ACE agregadas por el servicio.
 $task=$folder.RegisterTaskDefinition($taskName,$definition,18,$systemName,$null,5,'O:BAG:BAD:P(A;;GA;;;SY)(A;;GA;;;BA)')
 $registered=$true
 $sd=New-Object Security.AccessControl.RawSecurityDescriptor($task.GetSecurityDescriptor(5))
 # Se solicita D:P al crear y se verifica dueño y cada ACE del objeto de tarea.
 if($sd.Owner.Value -cne 'S-1-5-32-544'){throw 'runner_task_owner'}
 if($sd.DiscretionaryAcl.Count -ne 2){throw 'runner_task_acl_count'}
 $seen=@{}
 foreach($ace in $sd.DiscretionaryAcl){
  $sid=$ace.SecurityIdentifier.Value
  if($ace.AceQualifier -ne [Security.AccessControl.AceQualifier]::AccessAllowed -or $sid -notin @('S-1-5-18','S-1-5-32-544') -or $seen.ContainsKey($sid)){throw 'runner_task_acl_identity'}
  $seen[$sid]=$true
 }
 if($task.Definition.Triggers.Count -ne 0 -or $task.Definition.Settings.ExecutionTimeLimit -cne 'PT30S'){throw 'runner_task_policy'}
 $instance=$task.Run($null)
 $timer=[Diagnostics.Stopwatch]::StartNew()
 while(-not(Test-Path -LiteralPath ($root+'\result.json'))){
  if($timer.Elapsed.TotalSeconds -ge 35){throw 'runner_result_timeout'}
  Start-Sleep -Milliseconds 100
 }
 $i=Get-Item -LiteralPath ($root+'\result.json') -Force
 if($i.PSIsContainer -or ($i.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $i.Length -gt 32768){throw 'runner_result_bound'}
 $raw=[IO.File]::ReadAllText($i.FullName)
 $report=$raw|ConvertFrom-Json
 if($report.nonce -cne $nonce -or $report.schema -ne 1){throw 'runner_result_binding'}
} finally {
 if($registered){
  $own=$folder.GetTask($taskName)
  if($own.Definition.RegistrationInfo.Description -cne $description -or $own.Definition.Actions.Count -ne 1 -or $own.Definition.Actions.Item(1).Arguments -cne $action.Arguments){throw 'runner_task_changed'}
  if($own.State -eq 4){try{$own.Stop(0)}catch{if($own.State -eq 4){throw}}}
  $folder.DeleteTask($taskName,0)
 }
 Assert-Runner
 $items=@(Get-ChildItem -LiteralPath $root -Force)
 foreach($f in $items){if($f.PSIsContainer -or ($f.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $f.Name -notin @('owner.txt','payload.ps1','controller.ps1','result.json','result.next')){throw 'runner_cleanup_foreign_file'}}
 foreach($f in $items){Remove-Item -LiteralPath $f.FullName}
 Remove-Item -LiteralPath $root
 $cleanup=$true
}
if(-not $cleanup -or $null -eq $raw){throw 'runner_cleanup_failed'}
[Console]::WriteLine($raw)
'''


def quote(value):
    if not isinstance(value, str) or any(c in value for c in '\r\n\0'):
        raise RuntimeError('runner_path_invalid')
    return '"' + value.replace('\\', '\\\\').replace('"', '\\"') + '"'


def payload(nonce, source, common=COMMON):
    if not re.fullmatch('[0-9a-f]{32}', nonce) or not source or len(source.encode()) > 12000:
        raise RuntimeError('runner_source_bound')
    root = BASE + '\\quiet-' + nonce
    text = "$nonce='"+nonce+"';$root='"+root+"';" + common + r'''
$report=$null
try {
 Assert-Runner
 if([Security.Principal.WindowsIdentity]::GetCurrent().User.Value -cne 'S-1-5-18' -or [Diagnostics.Process]::GetCurrentProcess().SessionId -ne 0){throw 'runner_system_session_required'}
 $value=& {
''' + source + r'''
 }
 $report=@{schema=1;nonce=$nonce;ok=$true;result=$value;systemSessionZero=$true}
}catch{
 $cause=$_.Exception.GetBaseException()
 $code=if($cause.Message -cmatch '^[a-z_]{1,80}$'){$cause.Message}else{'non_enum_error'}
 $report=@{schema=1;nonce=$nonce;ok=$false;errorCode=$code;errorType=$cause.GetType().Name;systemSessionZero=([Diagnostics.Process]::GetCurrentProcess().SessionId -eq 0)}
}
$json=$report|ConvertTo-Json -Compress -Depth 8
if([Text.Encoding]::UTF8.GetByteCount($json) -gt 32768){$json='{"schema":1,"nonce":"'+$nonce+'","ok":false,"errorCode":"runner_output_bound","systemSessionZero":true}'}
# Publicación por rename: el controlador nunca lee un JSON a medio escribir.
[IO.File]::WriteAllText(($root+'\result.next'),$json,(New-Object Text.UTF8Encoding($false)))
[IO.File]::Move(($root+'\result.next'),($root+'\result.json'))
'''
    return root, text


class SshSystem:
    def __init__(self, remote, output, common=COMMON):
        self.remote = remote
        self.output = Path(output)
        self.common = common

    def call(self, source):
        nonce = uuid.uuid4().hex
        root, body = payload(nonce, source,self.common)
        digest = hashlib.sha256(body.encode()).hexdigest()
        controller = "$nonce='"+nonce+"';$root='"+root+"';$payloadHash='"+digest+"';"+CONTROLLER.replace(COMMON,self.common,1)
        files = {}
        for name, text in [('payload.ps1', body), ('controller.ps1', controller)]:
            p = self.output / ('quiet-'+nonce+'-'+name)
            # Bytes exactos: Windows no debe convertir LF a CRLF después de calcular SHA-256.
            p.write_bytes(text.encode('utf-8'))
            p.chmod(0o600)
            files[name] = p
        journal = self.output / ('quiet-'+nonce+'.json')
        def save(state, diagnostic=None):
            record={'schema':1,'nonce':nonce,'state':state,'payloadSha256':digest}
            if diagnostic is not None:record['diagnostic']=diagnostic
            journal.write_text(json.dumps(record)+'\n')
            journal.chmod(0o600)
        save('prepared')
        bootstrap = self.common + ";Assert-OwnVm;Assert-PrivateDirectory '"+BASE+"';if(Test-Path -LiteralPath '"+root+"'){throw 'runner_destination_exists'};$a=New-Object Security.AccessControl.DirectorySecurity;$a.SetSecurityDescriptorSddlForm('"+ACL+"');[IO.Directory]::CreateDirectory('"+root+"',$a)|Out-Null;[IO.File]::WriteAllText('"+root+"\\owner.txt','absorconnect-quiet-system-v1 "+nonce+"');@{ok=$true}|ConvertTo-Json -Compress"
        result = self.remote.powershell(bootstrap, timeout=15)
        if result.returncode != 0:
            raise RuntimeError('runner_bootstrap_failed')
        lines = ['put '+quote(str(p))+' '+quote('/'+root.replace('\\','/')+'/'+name) for name,p in files.items()]
        if self.remote.transfer(lines).returncode != 0:
            raise RuntimeError('runner_transfer_failed')
        save('uploaded')
        expected = hashlib.sha256(controller.encode()).hexdigest()
        path = root+'\\controller.ps1'
        invoke = "$ErrorActionPreference='Stop';try{if((Get-FileHash -LiteralPath '"+path+"' -Algorithm SHA256).Hash.ToLowerInvariant() -cne '"+expected+"'){throw 'runner_controller_hash'};Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force;& '"+path+"'}catch{$cause=$_.Exception.GetBaseException();$code=if($cause.Message -cmatch '^[a-z_]{1,80}$'){$cause.Message}else{'non_enum_error'};@{quietError=$true;errorCode=$code;errorType=$cause.GetType().Name;hresult=$cause.HResult;line=$_.InvocationInfo.ScriptLineNumber}|ConvertTo-Json -Compress;exit 78}"
        try:
            result = self.remote.powershell(invoke, timeout=45)
        except (subprocess.SubprocessError, OSError, RuntimeError):
            save('transport_uncertain')
            raise RuntimeError('runner_transport_uncertain') from None
        if result.returncode != 0 or len(result.stdout) > 32768:
            diagnostic=None
            try:
                candidate=json.loads(result.stdout.decode('utf-8-sig'))
                if set(candidate)=={'quietError','errorCode','errorType','hresult','line'} and candidate['quietError'] is True and re.fullmatch('[a-z_]{1,80}',candidate['errorCode']) and re.fullmatch('[A-Za-z0-9_]{1,80}',candidate['errorType']) and type(candidate['hresult']) is int and type(candidate['line']) is int:
                    diagnostic=candidate
            except (ValueError,UnicodeError,TypeError):pass
            save('controller_failed',diagnostic)
            raise RuntimeError('runner_controller_failed')
        try:
            value = json.loads(result.stdout.decode('utf-8-sig'))
        except (ValueError,UnicodeError):
            save('invalid_result')
            raise RuntimeError('runner_result_invalid') from None
        if value.get('schema') != 1 or value.get('nonce') != nonce or type(value.get('ok')) is not bool or value.get('systemSessionZero') is not True:
            save('invalid_result')
            raise RuntimeError('runner_result_invalid')
        save('task_and_files_removed')
        return value

    def recover(self, journal):
        """Retira únicamente una solicitud propia cuyo transporte quedó incierto."""
        path=Path(journal)
        if path.parent.resolve()!=self.output.resolve() or path.is_symlink() or not path.is_file() or path.stat().st_size>4096:
            raise RuntimeError('runner_recovery_journal')
        record=json.loads(path.read_text())
        nonce=record.get('nonce','')
        if not re.fullmatch('[0-9a-f]{32}',nonce) or path.name!='quiet-'+nonce+'.json':
            raise RuntimeError('runner_recovery_identity')
        if record.get('state')=='task_and_files_removed':
            return {'ok':True,'alreadyRemoved':True}
        expected={}
        for name in ['payload.ps1','controller.ps1']:
            local=self.output/('quiet-'+nonce+'-'+name)
            if not local.is_file() or local.is_symlink() or local.stat().st_size>24576:
                raise RuntimeError('runner_recovery_source')
            expected[name]=hashlib.sha256(local.read_bytes()).hexdigest()
        if expected['payload.ps1']!=record.get('payloadSha256'):
            raise RuntimeError('runner_recovery_source')
        source=r'''
$oldNonce='@NONCE@'
$oldRoot='C:\ProgramData\AbsorConnectLabSsh\quiet-'+$oldNonce
$name='AbsorConnectLabQuiet-'+$oldNonce
$scheduler=New-Object -ComObject Schedule.Service;$scheduler.Connect();$folder=$scheduler.GetFolder('\')
$task=@($folder.GetTasks(1)|Where-Object {$_.Name -ceq $name})
if($task.Count -gt 1){throw 'runner_recovery_task_count'}
if($task.Count -eq 1){
 $t=$task[0];$a=$t.Definition.Actions
 if($t.Definition.RegistrationInfo.Description -cne ('AbsorConnect own VM quiet diagnostic v1 '+$oldNonce) -or $a.Count -ne 1 -or $a.Item(1).Path -ine 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -or $a.Item(1).Arguments -cne ('-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+$oldRoot+'\payload.ps1"') -or $t.Definition.Triggers.Count -ne 0){throw 'runner_recovery_task_changed'}
}
if(Test-Path -LiteralPath $oldRoot){
 Assert-PrivateDirectory $oldRoot
 if([IO.File]::ReadAllText($oldRoot+'\owner.txt') -cne ('absorconnect-quiet-system-v1 '+$oldNonce)){throw 'runner_recovery_marker'}
 $items=@(Get-ChildItem -LiteralPath $oldRoot -Force)
 foreach($f in $items){
  if($f.PSIsContainer -or ($f.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $f.Name -notin @('owner.txt','payload.ps1','controller.ps1','result.json','result.next')){throw 'runner_recovery_foreign_file'}
  if($f.Name -in @('payload.ps1','controller.ps1')){
   $expected=if($f.Name -ceq 'payload.ps1'){'@PAYLOAD@'}else{'@CONTROLLER@'}
   if((Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash.ToLowerInvariant() -cne $expected){throw 'runner_recovery_source_changed'}
  }
 }
}
if($task.Count -eq 1){if($task[0].State -eq 4){try{$task[0].Stop(0)}catch{if($task[0].State -eq 4){throw}}};$folder.DeleteTask($name,0)}
if(Test-Path -LiteralPath $oldRoot){foreach($f in $items){Remove-Item -LiteralPath $f.FullName};Remove-Item -LiteralPath $oldRoot}
@{oldTaskRemoved=$true;oldFilesRemoved=$true}
'''.replace('@NONCE@',nonce).replace('@PAYLOAD@',expected['payload.ps1']).replace('@CONTROLLER@',expected['controller.ps1'])
        result=self.call(source)
        if result.get('ok') is not True or result.get('result')!={'oldTaskRemoved':True,'oldFilesRemoved':True}:
            raise RuntimeError('runner_recovery_failed')
        record['state']='task_and_files_removed'
        path.write_text(json.dumps(record)+'\n');path.chmod(0o600)
        return {'ok':True,'recovered':True}


class OwnedCiRemote:
    """Adaptador local de CI para probar el mismo contrato sin claves SSH ni red."""
    def __init__(self):
        self.common=owned_ci_common()
        self.marker=os.environ.get('GITHUB_RUN_ID','')+' '+os.environ.get('GITHUB_SHA','')
        if not re.fullmatch(r'[0-9]+ [0-9a-f]{40}',self.marker):raise RuntimeError('owned_ci_identity')

    def powershell(self, source, timeout=20):
        import base64
        script='[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)\n'+source
        encoded=base64.b64encode(script.encode('utf-16le')).decode()
        return subprocess.run(['powershell.exe','-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',encoded],capture_output=True,timeout=timeout)

    def transfer(self, lines, timeout=20):
        for line in lines:
            command,source,target=shlex.split(line)
            fixture=target in ['/C:/ProgramData/AbsorConnectVaultLab/absor-win-vault-check-lab.exe','/C:/ProgramData/AbsorConnectVaultLab/check-denials.ps1']
            if command!='put' or not (fixture or re.fullmatch(r'/C:/ProgramData/AbsorConnectLabSsh/quiet-[0-9a-f]{32}/(payload|controller)\.ps1',target)):
                raise RuntimeError('owned_ci_transfer_path')
            shutil.copyfile(source,target[1:])
        return type('Transfer',(),{'returncode':0})()

    def command(self, value, timeout=20):
        raise RuntimeError('owned_ci_no_reboot_or_shell')

    def prepare(self):
        source=self.common+";Assert-OwnVm;if(Test-Path -LiteralPath '"+BASE+"'){throw 'owned_ci_destination_exists'};$a=New-Object Security.AccessControl.DirectorySecurity;$a.SetSecurityDescriptorSddlForm('"+ACL+"');[IO.Directory]::CreateDirectory('"+BASE+"',$a)|Out-Null;[IO.File]::WriteAllText('"+BASE+"\\ci-owner.txt','"+self.marker+"')"
        if self.powershell(source).returncode!=0:raise RuntimeError('owned_ci_prepare_failed')

    def cleanup(self):
        source=self.common+";Assert-OwnVm;Assert-PrivateDirectory '"+BASE+"';if([IO.File]::ReadAllText('"+BASE+"\\ci-owner.txt') -cne '"+self.marker+"'){throw 'owned_ci_marker'};$items=@(Get-ChildItem -LiteralPath '"+BASE+"' -Force);if($items.Count -ne 1 -or $items[0].Name -cne 'ci-owner.txt' -or ($items[0].Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'owned_ci_cleanup_pending'};Remove-Item -LiteralPath $items[0].FullName;Remove-Item -LiteralPath '"+BASE+"'"
        if self.powershell(source).returncode!=0:raise RuntimeError('owned_ci_cleanup_failed')
