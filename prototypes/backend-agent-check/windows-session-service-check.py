#!/usr/bin/env python3
"""Matriz SCM optativa para la VM Windows propia; nunca controla el Mac/físicos."""
from pathlib import Path
import argparse,hashlib,importlib.util,json,os,re,subprocess,sys,time,uuid
REPO=Path(__file__).resolve().parents[2]
BINS=('absor-win-sessiond-lab.exe','absor-win-session-worker-lab.exe','absor-win-session-monitor-lab.exe')
ROOT=r'C:\ProgramData\AbsorConnectSessionLab'
STAGE=r'C:\ProgramData\AbsorConnectLabSsh\session-service-20261028'
SOURCE=r'C:\ProgramData\AbsorConnectLabSsh\session-source-20261028'
SERVICE='AbsorConnectSessionLab'
class LabError(Exception):pass
def require(ok,code):
    if not ok:raise LabError(code)
def module(path,name):
    require(path.is_file() and not path.is_symlink(),'private_helper_missing')
    s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
SNAPSHOT=r'''
$s=Get-CimInstance Win32_Service -Filter "Name='AbsorConnectSessionLab'";
$d='C:\ProgramData\AbsorConnectSessionLab';
$p=@(Get-CimInstance Win32_Process -Filter "Name='absor-win-sessiond-lab.exe' OR Name='absor-win-session-worker-lab.exe' OR Name='absor-win-session-monitor-lab.exe'" | ForEach-Object {[ordered]@{pid=$_.ProcessId;session=$_.SessionId;parent=$_.ParentProcessId;name=$_.Name;pathExpected=($_.ExecutablePath -ceq ($d+'\'+$_.Name))}});
[ordered]@{serviceState=if($s){$s.State}else{'absent'};servicePid=if($s){$s.ProcessId}else{0};serviceExitCode=if($s){$s.ExitCode}else{0};serviceSpecificExitCode=if($s){$s.ServiceSpecificExitCode}else{0};rootExists=(Test-Path -LiteralPath $d);stopMarker=(Test-Path -LiteralPath ($d+'\stopped.txt'));status=if(Test-Path -LiteralPath ($d+'\status.json')){Get-Content -LiteralPath ($d+'\status.json') -Raw|ConvertFrom-Json}else{$null};processes=$p;userLoggedOn=[bool](Get-CimInstance Win32_ComputerSystem).UserName;uac=Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System'|Select-Object EnableLUA,PromptOnSecureDesktop,ConsentPromptBehaviorAdmin,ConsentPromptBehaviorUser}|ConvertTo-Json -Depth 5 -Compress
'''
class Matrix:
    def __init__(self,lab,artifact,reboot):
        self.lab=lab;self.artifact=artifact;self.reboot=reboot
        self.remote=module(lab/'windows-vm-ssh/lab_remote.py','lab_remote')
        self.qga=module(lab/'windows-vm-ssh/qga_owned.py','qga_owned')
        self.out=lab/('windows-session-service-'+uuid.uuid4().hex);self.out.mkdir(mode=0o700)
        self.cases=[];self.installed=False;self.index=0
        self.meta=json.loads((artifact/'build.json').read_text())
        require(self.meta.get('schema')==1 and re.fullmatch('[0-9a-f]{40}',self.meta.get('commit','')),'artifact_metadata')
        require(set(self.meta['files'])==set(BINS),'artifact_names')
        for name in BINS:
            p=artifact/name;require(p.is_file() and not p.is_symlink() and p.stat().st_size<20000000,'artifact_file')
            require(hashlib.sha256(p.read_bytes()).hexdigest()==self.meta['files'][name],'artifact_hash')
    def save(self,name,value):
        p=self.out/name;p.write_text(json.dumps(value,indent=2)+'\n');p.chmod(0o600)
    def ps(self,source,timeout=20):
        p=self.remote.powershell("$ErrorActionPreference='Stop';"+source,timeout)
        require(p.returncode==0,'remote_command_failed')
        require(len(p.stdout)<32768,'remote_output_bound')
        try:return json.loads(p.stdout.decode('utf-8-sig'))
        except (UnicodeDecodeError,ValueError):raise LabError('remote_json') from None
    def system(self,source):
        v=self.qga.call(source)
        if v.get('ok') is not True:
            self.save('system-failure.json',v)
            raise LabError('system_'+v.get('errorCode','command_failed'))
        return v.get('result')
    def snapshot(self):
        v=self.ps(SNAPSHOT)
        require(v['uac']=={'EnableLUA':1,'PromptOnSecureDesktop':1,'ConsentPromptBehaviorAdmin':5,'ConsentPromptBehaviorUser':3},'uac_changed')
        require(len(v['processes'])<=3 and all(p['pathExpected'] for p in v['processes']),'foreign_process')
        if v['status']:
            s=v['status'];require(s['schema']==1 and s['ready_for_unattended'] is False and s['capture_tested'] is False and s['input_tested'] is False,'unsupported_readiness')
        self.index+=1;self.save('snapshot-%04d.json'%self.index,v);return v
    def wait(self,predicate,seconds=12):
        end=time.monotonic()+seconds
        while True:
            v=self.snapshot()
            if predicate(v):return v
            require(time.monotonic()<end,'condition_timeout')
            time.sleep(.15)
    def healthy(self,v):
        s=v.get('status');return bool(v['serviceState']=='Running' and s and not s['stopped'] and s['process']==v['servicePid'] and s['worker'] and s['worker_session']==s['console'] and s['console']>0 and s['desktop'] in ('default','winlogon') and len(v['processes'])==3)
    def running(self):return self.wait(self.healthy)
    def stopped(self,v):return v['serviceState']=='Stopped' and not v['processes']
    def case(self,name,**facts):
        require(all(v is True for v in facts.values()),'case_failed_'+name)
        self.cases.append({'case':name,'ok':True,**facts});print(json.dumps({'case':name,'ok':True}),flush=True)
    def invoke_source(self,name,action=None,user=False):
        path=REPO/'agent/windows-session-lab'/name;digest=hashlib.sha256(path.read_bytes()).hexdigest()
        target=SOURCE+chr(92)+name
        source="if((Get-FileHash -LiteralPath '%s' -Algorithm SHA256).Hash.ToLowerInvariant() -cne '%s'){throw 'source_hash'};Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force;& '%s' %s | ConvertFrom-Json"%(target,digest,target,('-Action '+action) if action else '')
        return self.ps(source.rsplit(' | ConvertFrom-Json',1)[0]) if user else self.system(source)
    def control(self,n):
        require(n in (128,129,130),'control_enum')
        self.ps("& \"$env:SystemRoot\\System32\\sc.exe\" control AbsorConnectSessionLab %d | Out-Null;if($LASTEXITCODE -ne 0){throw 'control_failed'};@{accepted=$true}|ConvertTo-Json -Compress"%n)
    def kill(self,v,kind):
        expected={'service':BINS[0],'worker':BINS[1],'monitor':BINS[2]}[kind]
        values=[p for p in v['processes'] if p['name']==expected];require(len(values)==1,'kill_target')
        pid=values[0]['pid'];require(type(pid) is int and 0<pid<2**32,'pid_type')
        self.ps("$p=Get-CimInstance Win32_Process -Filter 'ProcessId=%d';if($null -eq $p -or $p.ExecutablePath -cne '%s\\%s'){throw 'target_changed'};Stop-Process -Id %d -Force;@{killed=$true}|ConvertTo-Json -Compress"%(pid,ROOT,expected,pid))
    def stop(self):
        self.ps("Stop-Service -Name AbsorConnectSessionLab;@{requested=$true}|ConvertTo-Json -Compress")
        return self.wait(self.stopped)
    def resume(self):self.invoke_source('install.ps1','Resume');return self.running()
    def collisions(self):
        nonce=uuid.uuid4().hex
        self.system("$d='C:\\ProgramData\\AbsorConnectSessionLab';if(Test-Path -LiteralPath $d){throw 'collision_destination_exists'};if(Get-Service AbsorConnectSessionLab -ErrorAction SilentlyContinue){throw 'collision_service_exists'};New-Item -ItemType Directory -Path $d|Out-Null;[IO.File]::WriteAllText(($d+'\\preflight-owner.txt'),'%s');@{created=$true}"%nonce)
        blocked=False
        try:
            try:self.invoke_source('install.ps1','Install')
            except LabError as e:blocked=str(e)=='system_destination_exists'
            require(blocked,'destination_collision_not_refused')
        finally:
            self.system("$d='C:\\ProgramData\\AbsorConnectSessionLab';$items=@(Get-ChildItem -LiteralPath $d -Force);if($items.Count -ne 1 -or $items[0].Name -cne 'preflight-owner.txt' -or $items[0].PSIsContainer -or ($items[0].Attributes -band [IO.FileAttributes]::ReparsePoint) -or [IO.File]::ReadAllText($items[0].FullName) -cne '%s'){throw 'collision_sentinel_changed'};if(Get-Service AbsorConnectSessionLab -ErrorAction SilentlyContinue){throw 'collision_created_service'};Remove-Item -LiteralPath $items[0].FullName;Remove-Item -LiteralPath $d;@{unchangedAndRemoved=$true}"%nonce)
        self.case('foreign_destination_refused',unchanged=True)
        f=self.out/'system-failure.json'
        if f.exists():f.rename(self.out/'expected-destination-denial.json')
        self.system(r'''if(Test-Path -LiteralPath 'C:\ProgramData\AbsorConnectSessionLab'){throw 'collision_destination_exists'};if(Get-Service AbsorConnectSessionLab -ErrorAction SilentlyContinue){throw 'collision_service_exists'};$s=New-Service -Name AbsorConnectSessionLab -BinaryPathName '"C:\Windows\System32\cmd.exe" /c exit /b 0' -DisplayName 'AbsorConnect Session Lab sentinel' -StartupType Manual;$s.Dispose();@{manualSentinelCreated=$true}''')
        blocked=False
        try:
            try:self.invoke_source('install.ps1','Install')
            except LabError as e:blocked=str(e)=='system_service_exists'
            require(blocked,'service_collision_not_refused')
        finally:
            self.system(r'''$s=Get-CimInstance Win32_Service -Filter "Name='AbsorConnectSessionLab'";if($null -eq $s -or $s.PathName -cne '"C:\Windows\System32\cmd.exe" /c exit /b 0' -or $s.State -ne 'Stopped' -or $s.StartMode -ne 'Manual' -or (Test-Path -LiteralPath 'C:\ProgramData\AbsorConnectSessionLab')){throw 'collision_service_changed'};[GC]::Collect();[GC]::WaitForPendingFinalizers();& "$env:SystemRoot\System32\sc.exe" delete AbsorConnectSessionLab|Out-Null;if($LASTEXITCODE -ne 0){throw 'collision_service_delete'};@{unchangedAndRemoved=$true}''')
        self.wait(lambda v:v['serviceState']=='absent' and not v['rootExists'] and not v['processes'])
        self.case('foreign_service_refused',unchanged=True)
        f=self.out/'system-failure.json'
        if f.exists():f.rename(self.out/'expected-service-denial.json')
    def prepare(self):
        v=self.snapshot();require(v['serviceState']=='absent' and not v['rootExists'] and not v['processes'],'existing_installation')
        # Las dos carpetas pertenecen a este laboratorio; se rechazan enlaces y nombres ajenos.
        self.system(r'''$machine=Get-CimInstance Win32_ComputerSystem;if($machine.Manufacturer -ne 'QEMU' -or $machine.Model -ne 'QEMU Virtual Machine' -or [Security.Principal.WindowsIdentity]::GetCurrent().User.Value -ne 'S-1-5-18'){throw 'own_system_vm_required'};foreach($d in @('C:\ProgramData\AbsorConnectLabSsh\session-service-20261028','C:\ProgramData\AbsorConnectLabSsh\session-source-20261028')){if(-not(Test-Path -LiteralPath $d)){New-Item -ItemType Directory -Path $d|Out-Null;$a=New-Object Security.AccessControl.DirectorySecurity;$a.SetSecurityDescriptorSddlForm('O:SYG:SYD:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)');Set-Acl -LiteralPath $d -AclObject $a};$acl=Get-Acl -LiteralPath $d;$owner=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value;if($owner -notin @('S-1-5-18','S-1-5-32-544')){throw 'stage_owner'};foreach($r in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){if($r.AccessControlType -ne 'Allow' -or $r.IdentityReference.Value -notin @('S-1-5-18','S-1-5-32-544')){throw 'stage_acl'}};$i=Get-Item -LiteralPath $d -Force;if(($i.Attributes -band [IO.FileAttributes]::ReparsePoint) -or -not $i.PSIsContainer){throw 'stage_type'}};@{prepared=$true}''')
        lines=[]
        for name in (*BINS,'build.json'):lines.append('put '+str(self.artifact/name)+' /'+STAGE.replace(chr(92),'/')+'/'+name)
        for name in ('install.ps1','check-denials.ps1'):lines.append('put '+str(REPO/'agent/windows-session-lab'/name)+' /'+SOURCE.replace(chr(92),'/')+'/'+name)
        p=self.remote.transfer(lines);require(p.returncode==0,'artifact_transfer')
        digest=hashlib.sha256((self.artifact/'build.json').read_bytes()).hexdigest()
        self.system("$d='%s';if((Get-FileHash -LiteralPath ($d+'\\build.json') -Algorithm SHA256).Hash.ToLowerInvariant() -cne '%s'){throw 'manifest_hash'};$known=@('absor-win-sessiond-lab.exe','absor-win-session-worker-lab.exe','absor-win-session-monitor-lab.exe','build.json');$a=New-Object Security.AccessControl.FileSecurity;$a.SetSecurityDescriptorSddlForm('O:SYG:SYD:P(A;;FA;;;SY)(A;;FA;;;BA)');foreach($f in Get-ChildItem -LiteralPath $d -Force){if($f.Name -notin $known -or ($f.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $f.PSIsContainer){throw 'stage_foreign_file'};Set-Acl -LiteralPath $f.FullName -AclObject $a};@{verified=$true}"%(STAGE,digest))
        self.collisions()
        v=self.invoke_source('install.ps1','Install');self.installed=True;require(v.get('scmConfigurationVerified') is True,'scm_configuration_not_verified')
    def execute(self):
        self.prepare();v=self.running();self.case('scm_install',selectedConsole=True,metadataOnly=True)
        denials=self.invoke_source('check-denials.ps1',user=True);self.save('denials.json',denials)
        require(denials and all(x is True for x in denials['denials'].values()),'restricted_user_denials')
        self.case('restricted_user_denials',allDenied=True)
        old=v;self.kill(old,'worker');v=self.wait(lambda x:self.healthy(x) and x['status']['worker']!=old['status']['worker'])
        self.case('worker_crash',sameBroker=v['servicePid']==old['servicePid'],newGeneration=v['status']['generation']>old['status']['generation'])
        old=v;started=time.monotonic();self.control(128)
        v=self.wait(lambda x:self.healthy(x) and x['status']['worker']!=old['status']['worker'])
        self.case('worker_stall',sameBroker=v['servicePid']==old['servicePid'],bounded=time.monotonic()-started<6)
        old=v;self.kill(old,'service');v=self.wait(lambda x:self.healthy(x) and x['servicePid']!=old['servicePid'])
        self.case('scm_first_recovery',newBroker=True,noOldChildren=not any(p['pid'] in [q['pid'] for q in old['processes']] for p in v['processes']))
        old=v;self.control(129);v=self.wait(lambda x:self.healthy(x) and x['servicePid']!=old['servicePid'],15)
        self.case('monitor_stall',newBroker=True,noOldChildren=not any(p['pid'] in [q['pid'] for q in old['processes']] for p in v['processes']))
        self.control(130);self.wait(self.stopped,10);time.sleep(3);v=self.snapshot()
        self.case('scm_recovery_exhausted',stopped=self.stopped(v))
        self.resume();self.stop();time.sleep(7);v=self.snapshot()
        self.case('explicit_stop',stopped=self.stopped(v),marker=v['stopMarker'])
        self.ps("try{Start-Service -Name AbsorConnectSessionLab}catch{};@{requested=$true}|ConvertTo-Json -Compress")
        time.sleep(3);v=self.snapshot();self.case('stop_survives_plain_start',stopped=self.stopped(v),marker=v['stopMarker'])
        self.ps("[IO.File]::WriteAllText('C:\\ProgramData\\AbsorConnectSessionLab\\lab-owner.txt','invalid');@{damaged=$true}|ConvertTo-Json -Compress")
        try:
            self.ps("try{Start-Service -Name AbsorConnectSessionLab}catch{};@{requested=$true}|ConvertTo-Json -Compress")
            time.sleep(7);v=self.snapshot()
            self.case('corrupt_configuration',stopped=self.stopped(v),configurationExit=v['serviceSpecificExitCode']==78)
        finally:
            self.ps("[IO.File]::WriteAllText('C:\\ProgramData\\AbsorConnectSessionLab\\lab-owner.txt',\"ABSOR_CONNECT_OWN_WINDOWS_VM_LAB_V1`n\",(New-Object Text.UTF8Encoding($false)));@{restored=$true}|ConvertTo-Json -Compress")
        self.resume();self.control(130);time.sleep(.3);self.stop();time.sleep(7);v=self.snapshot()
        self.case('stop_during_actor_stall',stopped=self.stopped(v),marker=v['stopMarker'])
        v=self.resume()
        for _ in range(3):
            old=v;self.kill(old,'worker');v=self.wait(lambda x:self.healthy(x) and x['status']['worker']!=old['status']['worker'])
        self.kill(v,'worker');self.wait(self.stopped,10);time.sleep(3);v=self.snapshot()
        self.case('worker_retry_exhausted',stopped=self.stopped(v),boundedStarts=v['status']['worker_starts']<=4)
        self.resume()
        if self.reboot:
            # Solo esta VM, identificada por el instalador. No se altera la cuenta/UAC.
            p=self.remote.command('shutdown.exe /r /t 1',10);require(p.returncode==0,'reboot_request')
            time.sleep(3);end=time.monotonic()+150
            while True:
                try:v=self.snapshot()
                except (LabError,RuntimeError):v=None
                if v and self.healthy(v) and not v['userLoggedOn']:break
                require(time.monotonic()<end,'boot_without_user_timeout');time.sleep(2)
            self.case('boot_without_user',workerAtLogin=True,metadataOnly=True,noUser=True)
    def cleanup(self):
        if self.installed:
            self.invoke_source('install.ps1','Remove');self.installed=False
            v=self.snapshot();require(v['serviceState']=='absent' and not v['rootExists'] and not v['processes'],'cleanup_incomplete')
            self.case('service_removal',removed=True)
        self.save('cleanup.json',{'schema':1,'serviceRemoved':not self.installed})
def main():
    p=argparse.ArgumentParser();p.add_argument('lab',type=Path);p.add_argument('artifact',type=Path);p.add_argument('--skip-reboot',action='store_true');a=p.parse_args()
    m=Matrix(a.lab.resolve(),a.artifact.resolve(),not a.skip_reboot)
    error=None
    try:m.execute()
    except Exception as e:
        error=e;m.save('failure.json',{'schema':1,'errorType':type(e).__name__,'code':str(e) if isinstance(e,LabError) else 'unexpected_error'})
    try:m.cleanup()
    except Exception as e:
        if error is None:error=e
        m.save('cleanup-failure.json',{'schema':1,'errorType':type(e).__name__,'code':str(e) if isinstance(e,LabError) else 'unexpected_error'})
    m.save('report.json',{'schema':1,'ok':error is None,'artifactCommit':m.meta['commit'],'cases':m.cases,'bootTested':m.reboot and any(c['case']=='boot_without_user' for c in m.cases),'serviceRemoved':not m.installed,'captureTested':False,'inputTested':False,'readyForUnattended':False})
    if error is not None:raise error
    print(json.dumps({'ok':True,'cases':len(m.cases),'report':str(m.out/'report.json'),'bootTested':m.reboot,'readyForUnattended':False}),flush=True)
if __name__=='__main__':
    try:main()
    except Exception as e:print(json.dumps({'ok':False,'errorType':type(e).__name__,'code':str(e) if isinstance(e,LabError) else 'unexpected_error'}));sys.exit(3)
