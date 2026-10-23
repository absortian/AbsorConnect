// Diagnóstico local de cierre de sesión de la VM QEMU; no recibe credenciales ni órdenes de red.
// Se lanza desde el agente de invitado autorizado, nunca como parte del producto final.
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Threading;

public static class SessionProbe
{
    [DllImport("kernel32.dll")] static extern uint WTSGetActiveConsoleSessionId();
    [DllImport("wtsapi32.dll", SetLastError = true)]
    static extern bool WTSLogoffSession(IntPtr server, uint session, bool wait);
    [DllImport("wtsapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool WTSQuerySessionInformation(IntPtr server, uint session, int type, out IntPtr buffer, out uint bytes);
    [DllImport("wtsapi32.dll")] static extern void WTSFreeMemory(IntPtr memory);

    static bool HasUser(uint session)
    {
        IntPtr buffer; uint bytes;
        if (!WTSQuerySessionInformation(IntPtr.Zero, session, 5, out buffer, out bytes))
            throw new Win32Exception(Marshal.GetLastWin32Error());
        try { return bytes > 2 && !String.IsNullOrEmpty(Marshal.PtrToStringUni(buffer)); }
        finally { WTSFreeMemory(buffer); }
    }

    public static int Main(string[] args)
    {
        if (args.Length != 1 || (args[0] != "--status" && args[0] != "--logout-qemu-lab")) return 64;
        try {
            if (WindowsIdentity.GetCurrent().User.Value != "S-1-5-18" || Process.GetCurrentProcess().SessionId != 0)
                throw new InvalidOperationException("system_session_zero_required");
            using (var machine = Microsoft.Win32.RegistryKey.OpenBaseKey(Microsoft.Win32.RegistryHive.LocalMachine,
                Microsoft.Win32.RegistryView.Registry64))
            using (var bios = machine.OpenSubKey(@"HARDWARE\DESCRIPTION\System\BIOS")) {
                if (bios == null || !String.Equals(bios.GetValue("SystemManufacturer") as string, "QEMU", StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException("qemu_lab_required");
            }
            uint session = WTSGetActiveConsoleSessionId();
            if (session == 0 || session == UInt32.MaxValue) throw new InvalidOperationException("console_session_required");
            bool before = HasUser(session);
            bool logout = args[0] == "--logout-qemu-lab";
            if (logout && before) {
                // Solicita el cierre normal de la sesión seleccionada; no pulsa teclas ni cambia el login.
                if (!WTSLogoffSession(IntPtr.Zero, session, false)) throw new Win32Exception(Marshal.GetLastWin32Error());
                var timer = Stopwatch.StartNew();
                while (HasUser(session)) {
                    if (timer.ElapsedMilliseconds > 15000) throw new InvalidOperationException("logout_not_observed");
                    Thread.Sleep(200);
                }
            }
            Console.WriteLine("{\"schema\":1,\"consoleSessionId\":" + session + ",\"interactiveUserBefore\":" + (before ? "true" : "false") +
                ",\"logoutRequested\":" + (logout && before ? "true" : "false") + ",\"interactiveUserAfter\":" + (HasUser(session) ? "true" : "false") +
                ",\"inputTested\":false,\"readyForUnattended\":false}");
            return 0;
        } catch (Exception error) { Console.Error.WriteLine(error.GetType().Name + ": " + error.Message); return 3; }
    }
}
