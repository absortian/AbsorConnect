// Diagnóstico local Win32. No instala servicios, no cambia UAC, no aplica entrada ni abre red.
// El lanzador solo se admite desde SYSTEM y ejecuta este mismo binario, sin RPC.
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using System.Threading;

public static class CaptureProbe
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct StartupInfo {
        public int cb; public string reserved, desktop, title;
        public uint x, y, width, height, countX, countY, fill, flags;
        public ushort show, reservedCount; public IntPtr reservedData, stdin, stdout, stderr;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct ProcessInfo { public IntPtr process, thread; public uint processId, threadId; }
    [StructLayout(LayoutKind.Sequential)]
    struct Luid { public uint low; public int high; }
    [StructLayout(LayoutKind.Sequential)]
    struct TokenPrivileges { public uint count; public Luid luid; public uint attributes; }
    [StructLayout(LayoutKind.Sequential)]
    struct BitmapHeader {
        public uint size; public int width, height; public ushort planes, bitCount;
        public uint compression, imageSize; public int xPixels, yPixels; public uint used, important;
    }
    [DllImport("kernel32.dll")] static extern uint WTSGetActiveConsoleSessionId();
    [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr value);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForSingleObject(IntPtr value, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr value, out uint code);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool DuplicateTokenEx(IntPtr token, uint access, IntPtr attributes, int level, int type, out IntPtr duplicate);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool SetTokenInformation(IntPtr token, int type, ref uint value, uint size);
    [DllImport("wtsapi32.dll", SetLastError = true)] static extern bool WTSQueryUserToken(uint session, out IntPtr token);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateProcess(IntPtr process, uint code);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool LookupPrivilegeValue(string system, string name, out Luid luid);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool AdjustTokenPrivileges(IntPtr token, bool disable, ref TokenPrivileges value, uint length, IntPtr previous, IntPtr needed);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool CreateProcessAsUser(IntPtr token, string application, StringBuilder command, IntPtr processAttributes,
        IntPtr threadAttributes, bool inherit, uint flags, IntPtr environment, string directory, ref StartupInfo startup, out ProcessInfo process);
    [DllImport("user32.dll", SetLastError = true)] static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
    [DllImport("user32.dll", SetLastError = true)] static extern bool CloseDesktop(IntPtr desktop);
    [DllImport("user32.dll", SetLastError = true)] static extern bool SetThreadDesktop(IntPtr desktop);
    [DllImport("user32.dll")] static extern IntPtr GetThreadDesktop(uint thread);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool GetUserObjectInformation(IntPtr value, int index, StringBuilder output, uint length, out uint needed);
    [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll", SetLastError = true)] static extern IntPtr GetDC(IntPtr window);
    [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr window, IntPtr dc);
    [DllImport("gdi32.dll", SetLastError = true)] static extern IntPtr CreateCompatibleDC(IntPtr dc);
    [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr dc);
    [DllImport("gdi32.dll", SetLastError = true)] static extern IntPtr CreateDIBSection(IntPtr dc, ref BitmapHeader header, uint colors, out IntPtr pixels, IntPtr section, uint offset);
    [DllImport("gdi32.dll", SetLastError = true)] static extern IntPtr SelectObject(IntPtr dc, IntPtr bitmap);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr value);
    [DllImport("gdi32.dll")] static extern int SetStretchBltMode(IntPtr dc, int mode);
    [DllImport("gdi32.dll", SetLastError = true)]
    static extern bool StretchBlt(IntPtr target, int x, int y, int width, int height, IntPtr source, int sx, int sy, int sw, int sh, uint operation);
    [DllImport("gdi32.dll")] static extern bool GdiFlush();

    static void Check(bool value) { if (!value) throw new Win32Exception(Marshal.GetLastWin32Error()); }
    static string DesktopName(IntPtr desktop) {
        var name = new StringBuilder(256); uint needed;
        Check(GetUserObjectInformation(desktop, 2, name, 512, out needed));
        string value = name.ToString();
        return value.Equals("Default", StringComparison.OrdinalIgnoreCase) ? "Default" :
            value.Equals("Winlogon", StringComparison.OrdinalIgnoreCase) ? "Winlogon" : "other";
    }

    static int Launch(bool requestElevation = false) {
        if (WindowsIdentity.GetCurrent().User.Value != "S-1-5-18") throw new InvalidOperationException("system_context_required");
        uint session = WTSGetActiveConsoleSessionId();
        if (session == UInt32.MaxValue || session == 0) throw new InvalidOperationException("console_session_unavailable");
        IntPtr token = IntPtr.Zero, primary = IntPtr.Zero;
        try {
            Check(OpenProcessToken(GetCurrentProcess(), 0xF01FF, out token));
            Luid luid; Check(LookupPrivilegeValue(null, "SeTcbPrivilege", out luid));
            var privilege = new TokenPrivileges { count = 1, luid = luid, attributes = 2 };
            Check(AdjustTokenPrivileges(token, false, ref privilege, 0, IntPtr.Zero, IntPtr.Zero));
            if (Marshal.GetLastWin32Error() == 1300) throw new InvalidOperationException("tcb_privilege_unavailable");
            if (requestElevation) {
                Check(WTSQueryUserToken(session, out primary));
            } else {
                Check(DuplicateTokenEx(token, 0x02000000, IntPtr.Zero, 2, 1, out primary));
                Check(SetTokenInformation(primary, 12, ref session, 4));
            }
            string binary = Assembly.GetExecutingAssembly().Location;
            var startup = new StartupInfo { cb = Marshal.SizeOf(typeof(StartupInfo)), desktop = @"winsta0\default", flags = 1, show = 0 };
            ProcessInfo process;
            string mode = requestElevation ? "--request-elevation" : "--capture";
            Check(CreateProcessAsUser(primary, binary, new StringBuilder("\"" + binary + "\" " + mode),
                IntPtr.Zero, IntPtr.Zero, false, 0x08000000, IntPtr.Zero, Path.GetDirectoryName(binary), ref startup, out process));
            try {
                uint wait = WaitForSingleObject(process.process, requestElevation ? 180000u : 15000u);
                if (wait == 258 && requestElevation) {
                    // Retira solo su propio solicitante si nadie responde; no pulsa botones de UAC.
                    Check(TerminateProcess(process.process, 124));
                    throw new InvalidOperationException("uac_probe_timeout");
                }
                if (wait != 0) throw new InvalidOperationException("worker_wait_failed_" + wait);
                uint code; Check(GetExitCodeProcess(process.process, out code));
                Console.WriteLine("{\"workerExited\":true,\"workerExitCode\":" + code + ",\"sessionId\":" + session + "}");
                return checked((int)code);
            } finally { CloseHandle(process.thread); CloseHandle(process.process); }
        } finally { if (primary != IntPtr.Zero) CloseHandle(primary); if (token != IntPtr.Zero) CloseHandle(token); }
    }

    static int RequestElevation() {
        if (WindowsIdentity.GetCurrent().User.Value == "S-1-5-18" ||
            new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator)) {
            throw new InvalidOperationException("filtered_user_context_required");
        }
        try {
            // El único destino permitido es el propio diagnóstico; no abre instaladores ni herramientas ajenas.
            using (var process = Process.Start(new ProcessStartInfo {
                FileName = Assembly.GetExecutingAssembly().Location,
                Arguments = "--elevated-self-check", UseShellExecute = true, Verb = "runas"
            })) {
                if (process == null || !process.WaitForExit(10000)) return 124;
                return process.ExitCode;
            }
        } catch (Win32Exception error) {
            if (error.NativeErrorCode == 1223) return 1223;
            throw;
        }
    }

    static string Capture() {
        IntPtr desktop = OpenInputDesktop(0, false, 0x81);
        if (desktop == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        IntPtr original = GetThreadDesktop(GetCurrentThreadId());
        IntPtr screen = IntPtr.Zero, memory = IntPtr.Zero, bitmap = IntPtr.Zero, previous = IntPtr.Zero;
        try {
            string name = DesktopName(desktop);
            Check(SetThreadDesktop(desktop));
            int width = GetSystemMetrics(78), height = GetSystemMetrics(79);
            if (width < 1 || height < 1) throw new InvalidOperationException("no_display");
            screen = GetDC(IntPtr.Zero);
            if (screen == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
            memory = CreateCompatibleDC(screen);
            if (memory == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
            var header = new BitmapHeader { size = 40, width = 320, height = -180, planes = 1, bitCount = 32, imageSize = 320 * 180 * 4 };
            IntPtr pixels;
            bitmap = CreateDIBSection(screen, ref header, 0, out pixels, IntPtr.Zero, 0);
            if (bitmap == IntPtr.Zero || pixels == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
            previous = SelectObject(memory, bitmap);
            if (previous == IntPtr.Zero || previous == new IntPtr(-1)) throw new Win32Exception(Marshal.GetLastWin32Error());
            SetStretchBltMode(memory, 3);
            int frames = 0, variableFrames = 0;
            byte[] bytes = new byte[320 * 180 * 4];
            var elapsed = Stopwatch.StartNew();
            while (elapsed.ElapsedMilliseconds < 2000) {
                // Solo recuentos; nunca archivos, hashes de contenido, transmisión ni títulos.
                Check(StretchBlt(memory, 0, 0, 320, 180, screen, GetSystemMetrics(76), GetSystemMetrics(77), width, height, 0x40CC0020));
                GdiFlush(); Marshal.Copy(pixels, bytes, 0, bytes.Length);
                bool varied = false;
                for (int i = 4; i < bytes.Length; i += 4)
                    if (bytes[i] != bytes[0] || bytes[i + 1] != bytes[1] || bytes[i + 2] != bytes[2]) { varied = true; break; }
                if (varied) variableFrames++;
                Array.Clear(bytes, 0, bytes.Length); frames++;
                Thread.Sleep(200);
            }
            return "{\"schema\":1,\"platform\":\"windows\",\"captureApi\":\"gdi\",\"desktop\":\"" + name +
                "\",\"sessionId\":" + Process.GetCurrentProcess().SessionId + ",\"frames\":" + frames +
                ",\"nonUniformFrames\":" + variableFrames + ",\"inputTested\":false,\"readyForUnattended\":false}";
        } finally {
            if (previous != IntPtr.Zero && previous != new IntPtr(-1) && memory != IntPtr.Zero) SelectObject(memory, previous);
            if (bitmap != IntPtr.Zero) DeleteObject(bitmap);
            if (memory != IntPtr.Zero) DeleteDC(memory);
            if (screen != IntPtr.Zero) ReleaseDC(IntPtr.Zero, screen);
            SetThreadDesktop(original); CloseDesktop(desktop);
        }
    }

    public static int Main(string[] args) {
        if (args.Length != 1) return 64;
        try {
            if (args[0] == "--launch-console-probe") return Launch();
            if (args[0] == "--launch-uac-probe") return Launch(true);
            if (args[0] == "--request-elevation") return RequestElevation();
            if (args[0] == "--elevated-self-check") {
                // Si se autoriza manualmente, solo comprueba el contexto y termina, sin modificar nada.
                return new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator) ? 0 : 3;
            }
            if (args[0] != "--capture") return 64;
            string report = null; Exception failure = null;
            var thread = new Thread(delegate() { try { report = Capture(); } catch (Exception e) { failure = e; } });
            thread.IsBackground = true; thread.Start();
            if (!thread.Join(10000)) throw new InvalidOperationException("capture_timeout");
            if (failure != null) throw failure;
            string destination = Path.Combine(Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location), "capture-report.json");
            // Una ejecución no pisa informes anteriores. La carpeta debe estar protegida antes de compilar.
            using (var stream = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None)) {
                byte[] bytes = new UTF8Encoding(false).GetBytes(report + "\n"); stream.Write(bytes, 0, bytes.Length);
            }
            return 0;
        } catch (Exception error) {
            Console.Error.WriteLine(error.GetType().Name + ": " + error.Message); return 3;
        }
    }
}
