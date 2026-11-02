# Token restringido del usuario SSH existente; no crea cuentas ni pide credenciales.
$ErrorActionPreference='Stop'
$root='C:\ProgramData\AbsorConnectVaultLab'
if(-not(Test-Path -LiteralPath ($root+'\store\ready.dpapi'))){throw 'vault_fixture_missing'}
Add-Type -TypeDefinition @'
using System;
using System.Security.Principal;
using System.Runtime.InteropServices;
public static class AbsorVaultDenials {
 public sealed class Result {public bool ordinaryToken,credentialsReadDenied,counterWriteDenied,binaryReplaceDenied,binaryExecuteDenied,createFileDenied,returnedOriginalUser;}
 [StructLayout(LayoutKind.Sequential)] struct SidAndAttributes {public IntPtr Sid;public uint Attributes;}
 [DllImport("kernel32.dll")]static extern IntPtr GetCurrentProcess();
 [DllImport("advapi32.dll",SetLastError=true)]static extern bool OpenProcessToken(IntPtr process,uint access,out IntPtr token);
 [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool ConvertStringSidToSid(string value,out IntPtr sid);
 [DllImport("advapi32.dll",SetLastError=true)]static extern bool CreateRestrictedToken(IntPtr existing,uint flags,uint disableCount,[In] SidAndAttributes[] disable,uint deleteCount,IntPtr delete,uint restrictCount,[In] SidAndAttributes[] restrict,out IntPtr token);
 [DllImport("kernel32.dll")]static extern IntPtr LocalFree(IntPtr value);
 [DllImport("advapi32.dll",SetLastError=true)]static extern bool ImpersonateLoggedOnUser(IntPtr token);
 [DllImport("advapi32.dll",SetLastError=true)]static extern bool RevertToSelf();
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern IntPtr CreateFile(string path,uint access,uint share,IntPtr security,uint disposition,uint flags,IntPtr template);
 [DllImport("kernel32.dll")]static extern bool CloseHandle(IntPtr handle);
 static bool Denied(string path,uint access,uint disposition) {
  IntPtr h=CreateFile(path,access,3,IntPtr.Zero,disposition,0,IntPtr.Zero);int e=Marshal.GetLastWin32Error();
  if(h!=new IntPtr(-1)){CloseHandle(h);return false;}return e==5;
 }
 public static Result Check() {
  IntPtr current=IntPtr.Zero,token=IntPtr.Zero,ba=IntPtr.Zero,bu=IntPtr.Zero;bool impersonated=false;
  Result r=new Result();string original=WindowsIdentity.GetCurrent().User.Value;
  try {
   if(!OpenProcessToken(GetCurrentProcess(),0xA,out current))throw new Exception("token_open");
   if(!ConvertStringSidToSid("S-1-5-32-544",out ba)||!ConvertStringSidToSid("S-1-5-32-545",out bu))throw new Exception("sid_failed");
   if(!CreateRestrictedToken(current,1,1,new[]{new SidAndAttributes{Sid=ba}},0,IntPtr.Zero,1,new[]{new SidAndAttributes{Sid=bu}},out token))throw new Exception("restrict_failed");
   using(WindowsIdentity identity=new WindowsIdentity(token)){r.ordinaryToken=!new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator);}
   if(!r.ordinaryToken)throw new Exception("ordinary_token_required");
   if(!ImpersonateLoggedOnUser(token))throw new Exception("impersonation_failed");impersonated=true;
   r.credentialsReadDenied=Denied(@"C:\ProgramData\AbsorConnectVaultLab\store\credentials.dpapi",0x80000000,3);
   r.counterWriteDenied=Denied(@"C:\ProgramData\AbsorConnectVaultLab\store\attempts.dpapi",0x40000000,3);
   r.binaryReplaceDenied=Denied(@"C:\ProgramData\AbsorConnectVaultLab\absor-win-vault-check-lab.exe",0x10000,3);
   r.binaryExecuteDenied=Denied(@"C:\ProgramData\AbsorConnectVaultLab\absor-win-vault-check-lab.exe",0x20000000,3);
   r.createFileDenied=Denied(@"C:\ProgramData\AbsorConnectVaultLab\store\denied.tmp",0x40000000,1);
  }finally{
   if(impersonated&&!RevertToSelf())Environment.FailFast("revert_failed");
   if(token!=IntPtr.Zero)CloseHandle(token);if(current!=IntPtr.Zero)CloseHandle(current);
   if(ba!=IntPtr.Zero)LocalFree(ba);if(bu!=IntPtr.Zero)LocalFree(bu);
  }
  r.returnedOriginalUser=WindowsIdentity.GetCurrent().User.Value==original;return r;
 }
}
'@
[ordered]@{schema=1;restrictedExistingUser=$true;standardInteractiveUserTested=$false;denials=[AbsorVaultDenials]::Check();readyForUnattended=$false}|ConvertTo-Json -Depth 4 -Compress
