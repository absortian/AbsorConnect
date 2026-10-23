// Diagnóstico local Win32. No instala servicios, no cambia UAC ni abre red.
// La prueba opcional de entrada solo envía Escape al aviso UAC propio en una VM QEMU.
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
    static bool cleanupAttempted, cleanupDefaultObserved;
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
    [StructLayout(LayoutKind.Sequential)]
    struct KeyboardInput { public ushort key, scan; public uint flags, time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Sequential)]
    struct MouseInput { public int x, y; public uint data, flags, time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Explicit)]
    struct InputUnion {
        [FieldOffset(0)] public KeyboardInput keyboard;
        [FieldOffset(0)] public MouseInput mouse;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct Input { public uint type; public InputUnion data; }
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
    [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint count, Input[] input, int size);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
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

    static int Launch(bool requestElevation = false, bool testUacInput = false) {
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
            string mode = requestElevation ? "--request-elevation" : testUacInput ? "--uac-input" : "--capture";
            Check(CreateProcessAsUser(primary, binary, new StringBuilder("\"" + binary + "\" " + mode),
                IntPtr.Zero, IntPtr.Zero, false, 0x08000000, IntPtr.Zero, Path.GetDirectoryName(binary), ref startup, out process));
            try {
                uint wait = WaitForSingleObject(process.process, requestElevation ? 180000u : testUacInput ? 50000u : 15000u);
                if (wait == 258 && (requestElevation || testUacInput)) {
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

    static string InputDesktopName() {
        IntPtr desktop = OpenInputDesktop(0, false, 0x81);
        if (desktop == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        try { return DesktopName(desktop); } finally { CloseDesktop(desktop); }
    }

    static bool WaitForDefault(int milliseconds) {
        var wait = Stopwatch.StartNew();
        while (InputDesktopName() != "Default") {
            if (wait.ElapsedMilliseconds >= milliseconds) return false;
            Thread.Sleep(100);
        }
        return true;
    }

    static void RequireInputLab() {
        // Solo laboratorio local: ni políticas distintas ni otro equipo son objetivos admitidos.
        using (var machine = Microsoft.Win32.RegistryKey.OpenBaseKey(Microsoft.Win32.RegistryHive.LocalMachine,
            Microsoft.Win32.RegistryView.Registry64)) {
            using (var bios = machine.OpenSubKey(@"HARDWARE\DESCRIPTION\System\BIOS")) {
                if (bios == null || !String.Equals(bios.GetValue("SystemManufacturer") as string, "QEMU", StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException("qemu_lab_required");
            }
            using (var policy = machine.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System")) {
                if (policy == null || Convert.ToInt32(policy.GetValue("EnableLUA", 0)) != 1 ||
                    Convert.ToInt32(policy.GetValue("PromptOnSecureDesktop", 0)) != 1 ||
                    Convert.ToInt32(policy.GetValue("ConsentPromptBehaviorAdmin", 0)) != 5)
                    throw new InvalidOperationException("expected_uac_policy_required");
            }
        }
    }

    static string RunSecureEscape() {
        IntPtr token = IntPtr.Zero, primary = IntPtr.Zero;
        ProcessInfo worker = new ProcessInfo();
        try {
            Check(OpenProcessToken(GetCurrentProcess(), 0xF01FF, out token));
            Check(DuplicateTokenEx(token, 0x02000000, IntPtr.Zero, 2, 1, out primary));
            string binary = Assembly.GetExecutingAssembly().Location;
            var startup = new StartupInfo { cb = Marshal.SizeOf(typeof(StartupInfo)), desktop = @"winsta0\winlogon", flags = 1, show = 0 };
            Check(CreateProcessAsUser(primary, binary, new StringBuilder("\"" + binary + "\" --escape-uac"),
                IntPtr.Zero, IntPtr.Zero, false, 0x08000000, IntPtr.Zero, Path.GetDirectoryName(binary), ref startup, out worker));
            uint wait = WaitForSingleObject(worker.process, 10000);
            if (wait != 0) {
                TerminateProcess(worker.process, 124);
                throw new InvalidOperationException("secure_worker_timeout");
            }
            uint code; Check(GetExitCodeProcess(worker.process, out code));
            string report = File.ReadAllText(Path.Combine(Path.GetDirectoryName(binary), "escape-report.json"));
            if (code != 0) throw new InvalidOperationException("secure_worker_failed_" + code + "_" + report);
            return report;
        } finally {
            if (worker.process != IntPtr.Zero) { CloseHandle(worker.thread); CloseHandle(worker.process); }
            if (primary != IntPtr.Zero) CloseHandle(primary);
            if (token != IntPtr.Zero) CloseHandle(token);
        }
    }

    static string EscapeUac() {
        RequireInputLab();
        if (WindowsIdentity.GetCurrent().User.Value != "S-1-5-18" || Process.GetCurrentProcess().SessionId == 0)
            throw new InvalidOperationException("interactive_system_context_required");
        if (DesktopName(GetThreadDesktop(GetCurrentThreadId())) != "Winlogon" || InputDesktopName() != "Winlogon")
            throw new InvalidOperationException("secure_worker_desktop_required");
        uint foregroundPid;
        var foregroundWait = Stopwatch.StartNew();
        while (GetWindowThreadProcessId(GetForegroundWindow(), out foregroundPid) == 0) {
            if (InputDesktopName() != "Winlogon") throw new InvalidOperationException("secure_desktop_changed");
            if (foregroundWait.ElapsedMilliseconds > 4000) throw new InvalidOperationException("consent_window_unavailable");
            Thread.Sleep(100);
        }
        using (var foreground = Process.GetProcessById(checked((int)foregroundPid))) {
            if (!String.Equals(foreground.MainModule.FileName, Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "consent.exe"), StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("consent_foreground_required");
        }
        foreach (int key in new int[] { 0x1B, 0x10, 0x11, 0x12, 0x5B, 0x5C })
            if (GetAsyncKeyState(key) < 0) throw new InvalidOperationException("pressed_key_prevents_probe");
        var input = new Input[] {
            new Input { type = 1, data = new InputUnion { keyboard = new KeyboardInput { key = 0x1B } } },
            new Input { type = 1, data = new InputUnion { keyboard = new KeyboardInput { key = 0x1B, flags = 2 } } }
        };
        uint sent = SendInput(2, input, Marshal.SizeOf(typeof(Input)));
        int inputError = Marshal.GetLastWin32Error();
        if (sent != 2) {
            if (sent == 1) SendInput(1, new Input[] { input[1] }, Marshal.SizeOf(typeof(Input)));
            throw new InvalidOperationException("escape_input_incomplete_" + sent + "_error_" + inputError +
                "_size_" + Marshal.SizeOf(typeof(Input)) + "_process64_" + Environment.Is64BitProcess);
        }
        return "{\"desktop\":\"Winlogon\",\"eventsInserted\":2,\"foregroundWaitMilliseconds\":" + foregroundWait.ElapsedMilliseconds + ",\"inputSize\":" + Marshal.SizeOf(typeof(Input)) +
            ",\"sessionId\":" + Process.GetCurrentProcess().SessionId + "}";
    }

    static string UacInput() {
        if (WindowsIdentity.GetCurrent().User.Value != "S-1-5-18" || Process.GetCurrentProcess().SessionId == 0)
            throw new InvalidOperationException("interactive_system_context_required");
        RequireInputLab();
        if (!WaitForDefault(5000)) throw new InvalidOperationException("default_desktop_required_before_probe");
        uint session = WTSGetActiveConsoleSessionId();
        IntPtr token = IntPtr.Zero;
        ProcessInfo requester = new ProcessInfo();
        bool exited = false;
        try {
            // La copia SYSTEM de este trabajador conserva SeTcb habilitado por el lanzador.
            Check(WTSQueryUserToken(session, out token));
            string binary = Assembly.GetExecutingAssembly().Location;
            var startup = new StartupInfo { cb = Marshal.SizeOf(typeof(StartupInfo)), desktop = @"winsta0\default", flags = 1, show = 0 };
            Check(CreateProcessAsUser(token, binary, new StringBuilder("\"" + binary + "\" --request-elevation"),
                IntPtr.Zero, IntPtr.Zero, false, 0x08000000, IntPtr.Zero, Path.GetDirectoryName(binary), ref startup, out requester));
            var deadline = Stopwatch.StartNew();
            while (InputDesktopName() != "Winlogon") {
                if (WaitForSingleObject(requester.process, 0) == 0) throw new InvalidOperationException("requester_exited_before_secure_desktop");
                if (deadline.ElapsedMilliseconds > 10000) throw new InvalidOperationException("secure_desktop_timeout");
                Thread.Sleep(100);
            }
            string capture = Capture();
            WriteReport("uac-input-capture.json", capture);
            if (WaitForSingleObject(requester.process, 0) == 0) throw new InvalidOperationException("requester_no_longer_pending");
            string input = RunSecureEscape();
            uint wait = WaitForSingleObject(requester.process, 5000);
            if (wait != 0) throw new InvalidOperationException("cancel_not_observed_" + wait);
            exited = true;
            uint code; Check(GetExitCodeProcess(requester.process, out code));
            if (code != 1223) throw new InvalidOperationException("unexpected_requester_exit_" + code);
            if (!WaitForDefault(5000)) throw new InvalidOperationException("default_desktop_not_restored");
            return "{\"schema\":1,\"platform\":\"windows\",\"inputApi\":\"SendInput\",\"escapeEventsInserted\":2,\"secureWorker\":" + input +
                ",\"requesterExitCode\":" + code + ",\"secureDesktopEscapeTested\":true,\"capture\":" + capture +
                ",\"inputTested\":true,\"readyForUnattended\":false}";
        } finally {
            if (requester.process != IntPtr.Zero) {
                cleanupAttempted = true;
                if (!exited && WaitForSingleObject(requester.process, 0) == 258) {
                    TerminateProcess(requester.process, 124);
                    WaitForSingleObject(requester.process, 5000);
                }
                cleanupDefaultObserved = WaitForDefault(5000);
                CloseHandle(requester.thread); CloseHandle(requester.process);
            }
            if (token != IntPtr.Zero) CloseHandle(token);
        }
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

    static void WriteReport(string name, string report) {
        string destination = Path.Combine(Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location), name);
        using (var stream = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None)) {
            byte[] bytes = new UTF8Encoding(false).GetBytes(report + "\n"); stream.Write(bytes, 0, bytes.Length);
        }
    }

    public static int Main(string[] args) {
        if (args.Length != 1) return 64;
        try {
            if (args[0] == "--launch-console-probe") return Launch();
            if (args[0] == "--launch-uac-probe") return Launch(true);
            if (args[0] == "--launch-uac-input-probe") return Launch(false, true);
            if (args[0] == "--request-elevation") return RequestElevation();
            if (args[0] == "--elevated-self-check") {
                // Si se autoriza manualmente, solo comprueba el contexto y termina, sin modificar nada.
                return new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator) ? 0 : 3;
            }
            bool testUacInput = args[0] == "--uac-input";
            bool escapeUac = args[0] == "--escape-uac";
            if (args[0] != "--capture" && !testUacInput && !escapeUac) return 64;
            string report = null; Exception failure = null;
            var thread = new Thread(delegate() { try { report = testUacInput ? UacInput() : escapeUac ? EscapeUac() : Capture(); } catch (Exception e) { failure = e; } });
            thread.IsBackground = true; thread.Start();
            if (!thread.Join(testUacInput ? 45000 : 10000)) throw new InvalidOperationException("probe_timeout");
            if (failure != null) {
                if (testUacInput || escapeUac) {
                    string message = failure.Message.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", " ").Replace("\n", " ");
                    WriteReport(testUacInput ? "uac-input-report.json" : "escape-report.json", "{\"status\":\"input_probe_failed\",\"error\":\"" + message +
                        "\",\"cleanupAttempted\":" + (cleanupAttempted ? "true" : "false") + ",\"cleanupDefaultObserved\":" + (cleanupDefaultObserved ? "true" : "false") +
                        ",\"inputTested\":false,\"readyForUnattended\":false}");
                }
                throw failure;
            }
            // Una ejecución no pisa informes anteriores. La carpeta debe estar protegida antes de compilar.
            WriteReport(testUacInput ? "uac-input-report.json" : escapeUac ? "escape-report.json" : "capture-report.json", report);
            return 0;
        } catch (Exception error) {
            Console.Error.WriteLine(error.GetType().Name + ": " + error.Message); return 3;
        }
    }
}
