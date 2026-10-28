# Solo laboratorio QEMU del propietario. No instala el host de red/captura.
param([Parameter(Mandatory=$true)][ValidateSet('Install','Resume','Remove')][string]$Action)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$Root='C:\ProgramData\AbsorConnectSessionLab'
$Stage='C:\ProgramData\AbsorConnectLabSsh\session-service-20261028'
$Name='AbsorConnectSessionLab'
$Bins=@('absor-win-sessiond-lab.exe','absor-win-session-worker-lab.exe','absor-win-session-monitor-lab.exe')
$Marker="ABSOR_CONNECT_OWN_WINDOWS_VM_LAB_V1`n"
$Known=@($Bins)+@('lab-owner.txt','build.json','stopped.txt','status.json','failure.json','worker-failure.json','monitor-failure.json','status.json.tmp','failure.json.tmp','worker-failure.json.tmp','monitor-failure.json.tmp')
$Identity=[Security.Principal.WindowsIdentity]::GetCurrent()
if($Identity.User.Value -ne 'S-1-5-18'){throw 'system_required'}
$Machine=Get-CimInstance Win32_ComputerSystem
if($Machine.Manufacturer -ne 'QEMU' -or $Machine.Model -ne 'QEMU Virtual Machine'){throw 'own_qemu_vm_required'}
function Check-Closed([string]$Path,[bool]$Directory,[bool]$AllowAdminOwner=$false){
 $item=Get-Item -LiteralPath $Path -Force
 if([bool]$item.PSIsContainer -ne $Directory -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'path_type_or_link'}
 $acl=Get-Acl -LiteralPath $Path
 $owner=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
 if($owner -ne 'S-1-5-18' -and -not ($AllowAdminOwner -and $owner -eq 'S-1-5-32-544')){throw 'owner_required'}
 $rules=$acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])
 if($rules.Count -lt 1 -or $rules.Count -gt 4){throw 'acl_count'}
 foreach($r in $rules){if($r.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or $r.IdentityReference.Value -notin @('S-1-5-18','S-1-5-32-544')){throw 'acl_not_closed'}}
}
function Check-Tree {
 Check-Closed $Root $true
 Check-Closed (Join-Path $Root 'lab-owner.txt') $false
 if([IO.File]::ReadAllText((Join-Path $Root 'lab-owner.txt')) -cne $Marker){throw 'marker_mismatch'}
 foreach($f in Get-ChildItem -LiteralPath $Root -Force){if($f.Name -notin $Known){throw 'foreign_file'};Check-Closed $f.FullName $false}
}
function Check-Service {
 $s=Get-CimInstance Win32_Service -Filter "Name='$Name'"
 if($null -eq $s -or $s.PathName -cne ('"'+(Join-Path $Root $Bins[0])+'"') -or $s.StartName -ne 'LocalSystem'){throw 'foreign_or_missing_service'}
}
function Invoke-LabScm([string[]]$Arguments){& "$env:SystemRoot\System32\sc.exe" @Arguments | Out-Null;if($LASTEXITCODE -ne 0){throw 'sc_failed'}}
function Stop-Own {
 $s=Get-Service -Name $Name
 try {if($s.Status -ne 'Stopped'){ $s.Stop();$s.WaitForStatus([ServiceProcess.ServiceControllerStatus]::Stopped,[TimeSpan]::FromSeconds(12)) }}finally{$s.Dispose()}
}
function Check-Build([string]$Base){
 Check-Closed (Join-Path $Base 'build.json') $false
 $meta=Get-Content -LiteralPath (Join-Path $Base 'build.json') -Raw | ConvertFrom-Json
 if(@($meta.PSObject.Properties.Name).Count -ne 3 -or $meta.schema -ne 1 -or $meta.commit -notmatch '^[0-9a-f]{40}$' -or @($meta.files.PSObject.Properties.Name).Count -ne 3){throw 'build_schema'}
 foreach($b in $Bins){
  $path=Join-Path $Base $b;Check-Closed $path $false
  $hash=$meta.files.$b
  if($hash -notmatch '^[0-9a-f]{64}$' -or (Get-Item -LiteralPath $path).Length -gt 20000000 -or (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToLowerInvariant() -cne $hash){throw 'binary_hash'}
 }
}
# Recuperación finita: dos reinicios y una acción NONE; el último reinicio no se repite.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class AbsorLabScm {
 [StructLayout(LayoutKind.Sequential)] struct Action {public int Type; public uint Delay;}
 [StructLayout(LayoutKind.Sequential)] struct Recovery {public uint Reset;public IntPtr Reboot;public IntPtr Command;public uint Count;public IntPtr Actions;}
 [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr OpenSCManager(string machine,string database,uint access);
 [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr OpenService(IntPtr manager,string name,uint access);
 [DllImport("advapi32.dll",EntryPoint="ChangeServiceConfig2W",ExactSpelling=true,SetLastError=true)] static extern bool ChangeServiceConfig2(IntPtr service,uint level,ref Recovery value);
 [DllImport("advapi32.dll")] static extern bool CloseServiceHandle(IntPtr handle);
 [DllImport("advapi32.dll",EntryPoint="QueryServiceConfig2W",ExactSpelling=true,SetLastError=true)] static extern bool QueryServiceConfig2(IntPtr service,uint level,IntPtr value,uint size,out uint needed);
 [DllImport("advapi32.dll",SetLastError=true)] static extern bool QueryServiceObjectSecurity(IntPtr service,uint info,IntPtr buffer,uint size,out uint needed);
 [DllImport("advapi32.dll",SetLastError=true)] static extern bool GetSecurityDescriptorDacl(IntPtr descriptor,out bool present,out IntPtr acl,out bool defaults);
 [DllImport("advapi32.dll",SetLastError=true)] static extern bool GetAce(IntPtr acl,uint index,out IntPtr ace);
 [DllImport("advapi32.dll",EntryPoint="ConvertSidToStringSidW",ExactSpelling=true,SetLastError=true)] static extern bool ConvertSidToStringSid(IntPtr sid,out IntPtr value);
 [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr value);
 static void Verify(IntPtr service) {
  IntPtr b=Marshal.AllocHGlobal(8192);uint needed;
  try {
   if(!QueryServiceConfig2(service,4,b,8192,out needed)||Marshal.ReadInt32(b)!=0)throw new Exception("failure_flag_mismatch");
   if(!QueryServiceConfig2(service,2,b,8192,out needed))throw new Exception("recovery_query");
   Recovery r=(Recovery)Marshal.PtrToStructure(b,typeof(Recovery));if(r.Reset!=86400||r.Count!=3)throw new Exception("recovery_count");
   int size=Marshal.SizeOf(typeof(Action));int[] types={1,1,0};uint[] delays={1000,5000,0};
   for(int i=0;i<3;i++){Action a=(Action)Marshal.PtrToStructure(IntPtr.Add(r.Actions,i*size),typeof(Action));if(a.Type!=types[i]||a.Delay!=delays[i])throw new Exception("recovery_actions");}
   if(!QueryServiceConfig2(service,6,b,8192,out needed))throw new Exception("privileges_query");
   IntPtr text=Marshal.ReadIntPtr(b);System.Collections.Generic.List<string> names=new System.Collections.Generic.List<string>();
   for(int i=0;i<16;i++){string name=Marshal.PtrToStringUni(text);if(String.IsNullOrEmpty(name))break;names.Add(name);text=IntPtr.Add(text,(name.Length+1)*2);}
   names.Sort(StringComparer.Ordinal);string[] expected={"SeAssignPrimaryTokenPrivilege","SeChangeNotifyPrivilege","SeIncreaseQuotaPrivilege","SeTcbPrivilege"};if(String.Join("/",names.ToArray())!=String.Join("/",expected))throw new Exception("privileges_mismatch");
   if(!QueryServiceObjectSecurity(service,4,b,8192,out needed))throw new Exception("service_dacl_query");
   bool present,defaults;IntPtr acl;if(!GetSecurityDescriptorDacl(b,out present,out acl,out defaults)||!present||acl==IntPtr.Zero||Marshal.ReadInt16(acl,4)!=2)throw new Exception("service_dacl_count");
   System.Collections.Generic.HashSet<string> sids=new System.Collections.Generic.HashSet<string>();
   for(uint i=0;i<2;i++){IntPtr ace;if(!GetAce(acl,i,out ace)||Marshal.ReadByte(ace)!=0)throw new Exception("service_ace");IntPtr name;if(!ConvertSidToStringSid(IntPtr.Add(ace,8),out name))throw new Exception("service_sid");try{sids.Add(Marshal.PtrToStringUni(name));}finally{LocalFree(name);}}
   if(!sids.SetEquals(new[]{"S-1-5-18","S-1-5-32-544"}))throw new Exception("service_dacl_sids");
  }finally{Marshal.FreeHGlobal(b);}
 }

 public static void Configure() {
  IntPtr m=OpenSCManager(null,null,1),s=IntPtr.Zero,p=IntPtr.Zero;
  try {
   if(m==IntPtr.Zero)throw new Exception("scm_open");s=OpenService(m,"AbsorConnectSessionLab",0x20013);if(s==IntPtr.Zero)throw new Exception("service_open");
   int n=Marshal.SizeOf(typeof(Action));p=Marshal.AllocHGlobal(n*3);
   Marshal.StructureToPtr(new Action{Type=1,Delay=1000},p,false);
   Marshal.StructureToPtr(new Action{Type=1,Delay=5000},IntPtr.Add(p,n),false);
   Marshal.StructureToPtr(new Action{Type=0,Delay=0},IntPtr.Add(p,n*2),false);
   Recovery r=new Recovery{Reset=86400,Count=3,Actions=p};if(!ChangeServiceConfig2(s,2,ref r))throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(),"recovery_config");Verify(s);
  }finally{if(p!=IntPtr.Zero)Marshal.FreeHGlobal(p);if(s!=IntPtr.Zero)CloseServiceHandle(s);if(m!=IntPtr.Zero)CloseServiceHandle(m);}
 }
}
'@
if($Action -eq 'Install'){
 if(Test-Path -LiteralPath $Root){throw 'destination_exists'}
 if(Get-Service -Name $Name -ErrorAction SilentlyContinue){throw 'service_exists'}
 Check-Closed $Stage $true;Check-Build $Stage
 $Created=$false;$ServiceCreated=$false
 try {
  New-Item -ItemType Directory -Path $Root | Out-Null;$Created=$true
  $acl=New-Object Security.AccessControl.DirectorySecurity
  $acl.SetSecurityDescriptorSddlForm('O:SYG:SYD:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)')
  Set-Acl -LiteralPath $Root -AclObject $acl;Check-Closed $Root $true
  foreach($b in $Bins){Copy-Item -LiteralPath (Join-Path $Stage $b) -Destination (Join-Path $Root $b)}
  Copy-Item -LiteralPath (Join-Path $Stage 'build.json') -Destination (Join-Path $Root 'build.json')
  [IO.File]::WriteAllText((Join-Path $Root 'lab-owner.txt'),$Marker,(New-Object Text.UTF8Encoding($false)))
  $filesAcl=New-Object Security.AccessControl.FileSecurity
  $filesAcl.SetSecurityDescriptorSddlForm('O:SYG:SYD:P(A;;FA;;;SY)(A;;FA;;;BA)')
  foreach($f in Get-ChildItem -LiteralPath $Root -Force){
   if($f.Name -notin $Known -or ($f.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'foreign_new_file'}
   Set-Acl -LiteralPath $f.FullName -AclObject $filesAcl
  }
  Check-Tree;Check-Build $Root
  New-Service -Name $Name -BinaryPathName ('"'+(Join-Path $Root $Bins[0])+'"') -DisplayName 'AbsorConnect (laboratorio de sesiones)' -StartupType Automatic | Out-Null
  $ServiceCreated=$true;Check-Service
  Invoke-LabScm -Arguments @('sdset',$Name,'D:P(A;;GA;;;SY)(A;;GA;;;BA)')
  Invoke-LabScm -Arguments @('failureflag',$Name,'0')
  Invoke-LabScm -Arguments @('privs',$Name,'SeChangeNotifyPrivilege/SeTcbPrivilege/SeAssignPrimaryTokenPrivilege/SeIncreaseQuotaPrivilege')
  [AbsorLabScm]::Configure()
  Start-Service -Name $Name
  [ordered]@{schema=1;installed=$true;scmConfigurationVerified=$true;readyForUnattended=$false}|ConvertTo-Json -Compress
 }catch{
  if($ServiceCreated){Check-Service;Stop-Own;Invoke-LabScm -Arguments @('delete',$Name)}
  if($Created){
   Check-Closed $Root $true
   foreach($f in Get-ChildItem -LiteralPath $Root -Force){if($f.Name -notin $Known){throw 'foreign_rollback_file'};Check-Closed $f.FullName $false $true}
   foreach($f in Get-ChildItem -LiteralPath $Root -Force){Remove-Item -LiteralPath $f.FullName -Force}
   Remove-Item -LiteralPath $Root -Force
  }
  throw
 }
}elseif($Action -eq 'Resume'){
 Check-Tree;Check-Build $Root;Check-Service
 if((Get-CimInstance Win32_Service -Filter "Name='$Name'").State -ne 'Stopped'){throw 'stop_before_resume'}
 Invoke-LabScm -Arguments @('start',$Name,'resume')
 [ordered]@{schema=1;resumeRequested=$true;readyForUnattended=$false}|ConvertTo-Json -Compress
}else{
 Check-Tree;Check-Build $Root;Check-Service
 Stop-Own;Start-Sleep -Milliseconds 300;Check-Tree
 if(Get-CimInstance Win32_Process -Filter "Name='absor-win-session-worker-lab.exe' OR Name='absor-win-session-monitor-lab.exe' OR Name='absor-win-sessiond-lab.exe'"){throw 'lab_process_still_alive'}
 Invoke-LabScm -Arguments @('delete',$Name)
 foreach($f in Get-ChildItem -LiteralPath $Root -Force){Remove-Item -LiteralPath $f.FullName -Force}
 Remove-Item -LiteralPath $Root -Force
 [ordered]@{schema=1;removed=$true;readyForUnattended=$false}|ConvertTo-Json -Compress
}
