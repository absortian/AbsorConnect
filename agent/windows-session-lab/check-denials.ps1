# Sonda de acceso con el token ya existente de la consola. Sin contraseñas/entrada.
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if([Security.Principal.WindowsIdentity]::GetCurrent().User.Value -ne 'S-1-5-18'){throw 'system_required'}
$machine=Get-CimInstance Win32_ComputerSystem
if($machine.Manufacturer -ne 'QEMU' -or $machine.Model -ne 'QEMU Virtual Machine'){throw 'own_qemu_vm_required'}
$service=Get-CimInstance Win32_Service -Filter "Name='AbsorConnectSessionLab'"
if($null -eq $service -or $service.State -ne 'Running'){throw 'service_not_running'}
$root='C:\ProgramData\AbsorConnectSessionLab'
$meta=Get-Content -LiteralPath ($root+'\status.json') -Raw|ConvertFrom-Json
$child=Get-CimInstance Win32_Process -Filter ('ProcessId='+[string]$meta.worker)
$pipe=[regex]::Match($child.CommandLine,'\\\\\.\\pipe\\AbsorConnectSessionLab-[0-9]+-[0-9a-f]{32}').Value
if($pipe.Length -lt 60){throw 'pipe_missing'}
Add-Type -TypeDefinition @'
using System;
using System.Security.Principal;
using System.Runtime.InteropServices;
public static class AbsorLabDenials {
 public sealed class Result {public bool ordinaryToken,markerReadDenied,markerWriteDenied,workerExecuteDenied,pipeDenied,serviceStopDenied,serviceKillDenied,workerKillDenied,returnedSystem;}
 [StructLayout(LayoutKind.Sequential)] struct Luid {public uint Low;public int High;}
 [StructLayout(LayoutKind.Sequential)] struct Privilege {public uint Count;public Luid Id;public uint Flags;}
 [DllImport("kernel32.dll")]static extern IntPtr GetCurrentProcess();
 [DllImport("kernel32.dll")]static extern uint WTSGetActiveConsoleSessionId();
 [DllImport("wtsapi32.dll",SetLastError=true)]static extern bool WTSQueryUserToken(uint session,out IntPtr token);
 [DllImport("advapi32.dll",SetLastError=true)]static extern bool OpenProcessToken(IntPtr process,uint access,out IntPtr token);
 [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool LookupPrivilegeValue(string system,string name,out Luid id);
 [DllImport("advapi32.dll",SetLastError=true)]static extern bool AdjustTokenPrivileges(IntPtr token,bool disable,ref Privilege privileges,uint length,IntPtr previous,IntPtr returned);
 [DllImport("advapi32.dll",SetLastError=true)]static extern bool ImpersonateLoggedOnUser(IntPtr token);
 [DllImport("advapi32.dll",SetLastError=true)]static extern bool RevertToSelf();
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern IntPtr CreateFile(string path,uint access,uint share,IntPtr security,uint disposition,uint flags,IntPtr template);
 [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern IntPtr OpenSCManager(string machine,string database,uint access);
 [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern IntPtr OpenService(IntPtr manager,string name,uint access);
 [DllImport("advapi32.dll")]static extern bool CloseServiceHandle(IntPtr handle);
 [DllImport("kernel32.dll",SetLastError=true)]static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
 [DllImport("kernel32.dll")]static extern bool CloseHandle(IntPtr handle);
 static bool DeniedFile(string path,uint access) {IntPtr h=CreateFile(path,access,3,IntPtr.Zero,3,0,IntPtr.Zero);int e=Marshal.GetLastWin32Error();if(h!=new IntPtr(-1)){CloseHandle(h);return false;}return e==5;}
 static bool DeniedKill(uint pid) {IntPtr h=OpenProcess(1,false,pid);int e=Marshal.GetLastWin32Error();if(h!=IntPtr.Zero){CloseHandle(h);return false;}return e==5;}
 public static Result Check(string pipe,uint service,uint worker) {
  IntPtr token=IntPtr.Zero,current=IntPtr.Zero,manager=IntPtr.Zero;bool impersonated=false;Result r=new Result();
  try {
   if(!OpenProcessToken(GetCurrentProcess(),0x28,out current))throw new Exception("token_open");
   Luid id;if(!LookupPrivilegeValue(null,"SeTcbPrivilege",out id))throw new Exception("privilege_lookup");
   Privilege p=new Privilege{Count=1,Id=id,Flags=2};if(!AdjustTokenPrivileges(current,false,ref p,0,IntPtr.Zero,IntPtr.Zero))throw new Exception("privilege_enable");
   uint seat=WTSGetActiveConsoleSessionId();if(seat==0||seat==uint.MaxValue||!WTSQueryUserToken(seat,out token))throw new Exception("no_user_token");
   using(WindowsIdentity identity=new WindowsIdentity(token)){r.ordinaryToken=!new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator);}
   if(!r.ordinaryToken)throw new Exception("ordinary_token_required");
   manager=OpenSCManager(null,null,1);if(manager==IntPtr.Zero)throw new Exception("manager_open");
   if(!ImpersonateLoggedOnUser(token))throw new Exception("impersonation_failed");impersonated=true;
   r.markerReadDenied=DeniedFile(@"C:\ProgramData\AbsorConnectSessionLab\lab-owner.txt",0x80000000);
   r.markerWriteDenied=DeniedFile(@"C:\ProgramData\AbsorConnectSessionLab\lab-owner.txt",0x40000000);
   r.workerExecuteDenied=DeniedFile(@"C:\ProgramData\AbsorConnectSessionLab\absor-win-session-worker-lab.exe",0x20000000);
   r.pipeDenied=DeniedFile(pipe,0xC0000000);
   IntPtr s=OpenService(manager,"AbsorConnectSessionLab",0x20);int e=Marshal.GetLastWin32Error();r.serviceStopDenied=s==IntPtr.Zero&&e==5;if(s!=IntPtr.Zero)CloseServiceHandle(s);
   r.serviceKillDenied=DeniedKill(service);r.workerKillDenied=DeniedKill(worker);
  }finally{if(impersonated&&!RevertToSelf())Environment.FailFast("revert_failed");if(manager!=IntPtr.Zero)CloseServiceHandle(manager);if(token!=IntPtr.Zero)CloseHandle(token);if(current!=IntPtr.Zero)CloseHandle(current);}
  r.returnedSystem=WindowsIdentity.GetCurrent().User.Value=="S-1-5-18";return r;
 }
}
'@
$r=[AbsorLabDenials]::Check($pipe,[uint32]$service.ProcessId,[uint32]$meta.worker)
[ordered]@{schema=1;denials=$r;captureTested=$false;inputTested=$false;readyForUnattended=$false}|ConvertTo-Json -Depth 4 -Compress
