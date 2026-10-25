// Diagnóstico local Win32. No instala servicios, no cambia UAC ni abre red.
// Entrada opcional y acotada: Escape al UAC propio/LogonUI o clic/letra en una ventana propia de la VM QEMU.
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

    enum ProbeMode { Capture, Elevation, UacInput, OwnUser, OwnSystem, ElevatedInput, LockEscape, FocusSelf, LogonFocus }
    enum SecureProbeMode { UacEscape, LogonEscape, LogonFocus }

    static int Launch(ProbeMode mode = ProbeMode.Capture) {
        bool requestElevation = mode == ProbeMode.Elevation, testUacInput = mode == ProbeMode.UacInput;
        bool ownedInput = mode == ProbeMode.OwnUser || mode == ProbeMode.OwnSystem;
        bool userInput = mode == ProbeMode.OwnUser || mode == ProbeMode.FocusSelf;
        bool elevatedInput = mode == ProbeMode.ElevatedInput, lockEscape = mode == ProbeMode.LockEscape;
        bool focusSelf = mode == ProbeMode.FocusSelf, logonFocus = mode == ProbeMode.LogonFocus;
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
            if (requestElevation || userInput) {
                Check(WTSQueryUserToken(session, out primary));
            } else {
                Check(DuplicateTokenEx(token, 0x02000000, IntPtr.Zero, 2, 1, out primary));
                Check(SetTokenInformation(primary, 12, ref session, 4));
            }
            string binary = Assembly.GetExecutingAssembly().Location;
            var startup = new StartupInfo { cb = Marshal.SizeOf(typeof(StartupInfo)), desktop = @"winsta0\default", flags = 1, show = (ushort)(ownedInput || focusSelf ? 5 : 0) };
            ProcessInfo process;
            string commandMode = focusSelf ? "--focus-navigation-self" : logonFocus ? "--logon-focus-coordinator" : lockEscape ? "--lock-escape-coordinator" : elevatedInput ? "--elevated-input-injector" : ownedInput ? (userInput ? "--owned-input-user" : "--owned-input-system") :
                requestElevation ? "--request-elevation" : testUacInput ? "--uac-input" : "--capture";
            Check(CreateProcessAsUser(primary, binary, new StringBuilder("\"" + binary + "\" " + commandMode),
                IntPtr.Zero, IntPtr.Zero, false, 0x08000000, IntPtr.Zero, Path.GetDirectoryName(binary), ref startup, out process));
            try {
                uint wait = WaitForSingleObject(process.process, requestElevation ? 180000u : testUacInput ? 50000u : 15000u);
                if (wait == 258 && (requestElevation || testUacInput || ownedInput || elevatedInput || lockEscape || focusSelf || logonFocus)) {
                    // Retira solo su trabajador si vence el plazo; no pulsa botones de UAC.
                    Check(TerminateProcess(process.process, 124));
                    throw new InvalidOperationException(ownedInput || elevatedInput || lockEscape || focusSelf || logonFocus ? "input_probe_timeout" : "uac_probe_timeout");
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

    static string RunSecureProbe(SecureProbeMode mode = SecureProbeMode.UacEscape) {
        string argument = mode == SecureProbeMode.LogonFocus ? "--logon-focus" :
            mode == SecureProbeMode.LogonEscape ? "--escape-logon" : "--escape-uac";
        string reportName = mode == SecureProbeMode.LogonFocus ? "logon-focus-report.json" :
            mode == SecureProbeMode.LogonEscape ? "lock-escape-report.json" : "escape-report.json";
        if (WindowsIdentity.GetCurrent().User.Value != "S-1-5-18" || Process.GetCurrentProcess().SessionId == 0 ||
            WTSGetActiveConsoleSessionId() != Process.GetCurrentProcess().SessionId)
            throw new InvalidOperationException("interactive_system_context_required");
        IntPtr token = IntPtr.Zero, primary = IntPtr.Zero;
        ProcessInfo worker = new ProcessInfo();
        try {
            Check(OpenProcessToken(GetCurrentProcess(), 0xF01FF, out token));
            Check(DuplicateTokenEx(token, 0x02000000, IntPtr.Zero, 2, 1, out primary));
            string binary = Assembly.GetExecutingAssembly().Location;
            var startup = new StartupInfo { cb = Marshal.SizeOf(typeof(StartupInfo)), desktop = @"winsta0\winlogon", flags = 1, show = 0 };
            Check(CreateProcessAsUser(primary, binary, new StringBuilder("\"" + binary + "\" " + argument),
                IntPtr.Zero, IntPtr.Zero, false, 0x08000000, IntPtr.Zero, Path.GetDirectoryName(binary), ref startup, out worker));
            uint wait = WaitForSingleObject(worker.process, 10000);
            if (wait != 0) {
                TerminateProcess(worker.process, 124);
                throw new InvalidOperationException("secure_worker_timeout");
            }
            uint code; Check(GetExitCodeProcess(worker.process, out code));
            string report = File.ReadAllText(Path.Combine(Path.GetDirectoryName(binary), reportName));
            if (code != 0) throw new InvalidOperationException("secure_worker_failed_" + code + "_" + report);
            return report;
        } finally {
            if (worker.process != IntPtr.Zero) { CloseHandle(worker.thread); CloseHandle(worker.process); }
            if (primary != IntPtr.Zero) CloseHandle(primary);
            if (token != IntPtr.Zero) CloseHandle(token);
        }
    }

    static string EscapeUac(bool logon = false) {
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
            if (!String.Equals(foreground.MainModule.FileName, Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), logon ? "LogonUI.exe" : "consent.exe"), StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException(logon ? "logon_foreground_required" : "consent_foreground_required");
        }
        foreach (int key in new int[] { 0x1B, 0x10, 0x11, 0x12, 0x5B, 0x5C })
            if (GetAsyncKeyState(key) < 0) throw new InvalidOperationException("pressed_key_prevents_probe");
        if (logon) {
            for (int key = 1; key < 255; key++)
                if (GetAsyncKeyState(key) < 0) throw new InvalidOperationException("pressed_key_prevents_logon_probe");
            uint currentPid;
            if (InputDesktopName() != "Winlogon" ||
                GetWindowThreadProcessId(GetForegroundWindow(), out currentPid) == 0 || currentPid != foregroundPid)
                throw new InvalidOperationException("logon_foreground_changed");
        }
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
        return "{\"desktop\":\"Winlogon\",\"foregroundKind\":\"" + (logon ? "logon" : "consent") + "\",\"eventsInserted\":2,\"foregroundWaitMilliseconds\":" + foregroundWait.ElapsedMilliseconds + ",\"inputSize\":" + Marshal.SizeOf(typeof(Input)) +
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
            string input = RunSecureProbe();
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

    // Ventana Win32 sin campos de credenciales. No permite elegir texto, coordenadas ni destino.
    [StructLayout(LayoutKind.Sequential)]
    struct OwnedPoint { public int x, y; }
    [StructLayout(LayoutKind.Sequential)]
    struct OwnedRect { public int left, top, right, bottom; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct OwnedWindowClass {
        public uint style; public IntPtr procedure; public int classExtra, windowExtra;
        public IntPtr instance, icon, cursor, background; public string menu, name;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct OwnedMessage {
        public IntPtr window; public uint message; public UIntPtr wParam; public IntPtr lParam;
        public uint time; public OwnedPoint point; public uint privateValue;
    }
    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    delegate IntPtr OwnedWindowProcedure(IntPtr window, uint message, UIntPtr wParam, IntPtr lParam);
    static readonly OwnedWindowProcedure ownedProcedure = HandleOwnedMessage;
    static int ownedMouseDown, ownedMouseUp, ownedKeyDown, ownedKeyUp, ownedCharacters;
    static IntPtr ownedWindow;
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr GetModuleHandle(string name);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern ushort RegisterClass(ref OwnedWindowClass value);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool UnregisterClass(string name, IntPtr instance);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr CreateWindowEx(uint extended, string name, string title, uint style, int x, int y,
        int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr parameter);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr DefWindowProc(IntPtr window, uint message, UIntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] static extern IntPtr SetFocus(IntPtr window);
    [DllImport("user32.dll")] static extern IntPtr GetFocus();
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] static extern bool DestroyWindow(IntPtr window);
    [DllImport("user32.dll")] static extern bool PeekMessage(out OwnedMessage message, IntPtr window, uint min, uint max, uint flags);
    [DllImport("user32.dll")] static extern bool TranslateMessage(ref OwnedMessage message);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr DispatchMessage(ref OwnedMessage message);
    [DllImport("user32.dll", SetLastError = true)] static extern bool GetCursorPos(out OwnedPoint point);
    [DllImport("user32.dll", SetLastError = true)] static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll", SetLastError = true)] static extern bool GetClientRect(IntPtr window, out OwnedRect rect);
    [DllImport("user32.dll", SetLastError = true)] static extern bool ClientToScreen(IntPtr window, ref OwnedPoint point);
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(OwnedPoint point);

    static IntPtr HandleOwnedMessage(IntPtr window, uint message, UIntPtr wParam, IntPtr lParam) {
        if (window == ownedWindow) {
            if (message == 0x0201) ownedMouseDown++;
            if (message == 0x0202) ownedMouseUp++;
            if (message == 0x0100 && wParam.ToUInt64() == 0xE7) ownedKeyDown++;
            if (message == 0x0101 && wParam.ToUInt64() == 0xE7) ownedKeyUp++;
            if (message == 0x0102 && wParam.ToUInt64() == 65) ownedCharacters++;
        }
        return DefWindowProc(window, message, wParam, lParam);
    }

    static void PumpOwnedUntil(Func<bool> complete, int milliseconds) {
        var timer = Stopwatch.StartNew();
        do {
            OwnedMessage message;
            while (PeekMessage(out message, IntPtr.Zero, 0, 0, 1)) {
                TranslateMessage(ref message); DispatchMessage(ref message);
            }
            if (!IsWindow(ownedWindow)) throw new InvalidOperationException("owned_window_closed");
            if (complete()) return;
            Thread.Sleep(10);
        } while (timer.ElapsedMilliseconds < milliseconds);
        throw new InvalidOperationException("owned_input_observation_timeout");
    }

    static void RequireOwnedForeground() {
        uint pid;
        if (InputDesktopName() != "Default" || DesktopName(GetThreadDesktop(GetCurrentThreadId())) != "Default" ||
            WTSGetActiveConsoleSessionId() != Process.GetCurrentProcess().SessionId ||
            GetForegroundWindow() != ownedWindow || GetFocus() != ownedWindow ||
            GetWindowThreadProcessId(ownedWindow, out pid) == 0 || pid != Process.GetCurrentProcess().Id)
            throw new InvalidOperationException("owned_input_context_required");
        for (int key = 1; key < 255; key++)
            if (GetAsyncKeyState(key) < 0) throw new InvalidOperationException("pressed_key_prevents_owned_probe");
    }

    static void SendOwnedPair(Input down, Input up) {
        RequireOwnedForeground();
        if (down.type == 0) {
            OwnedPoint cursor;
            if (!GetCursorPos(out cursor) || WindowFromPoint(cursor) != ownedWindow)
                throw new InvalidOperationException("owned_pointer_target_required");
        }
        uint sent = SendInput(2, new Input[] { down, up }, Marshal.SizeOf(typeof(Input)));
        if (sent != 2) {
            // Si entró solo la pulsación, libera el mismo botón/tecla para no dejarlo retenido.
            if (sent == 1) SendInput(1, new Input[] { up }, Marshal.SizeOf(typeof(Input)));
            throw new InvalidOperationException("owned_input_pair_incomplete");
        }
    }

    static int OwnedInput(bool userInput, bool elevatedTarget = false) {
        RequireInputLab();
        bool system = WindowsIdentity.GetCurrent().User.Value == "S-1-5-18";
        bool admin = new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator);
        if (elevatedTarget) {
            if (system || !admin || Process.GetCurrentProcess().SessionId == 0)
                throw new InvalidOperationException("elevated_target_context_required");
            IntPtr current;
            Check(OpenProcessToken(GetCurrentProcess(), 8, out current));
            try { RequireHighToken(current); } finally { CloseHandle(current); }
        } else if (Process.GetCurrentProcess().SessionId == 0 || system == userInput || admin == userInput)
            throw new InvalidOperationException("owned_input_token_context_required");
        if (InputDesktopName() != "Default" || DesktopName(GetThreadDesktop(GetCurrentThreadId())) != "Default")
            throw new InvalidOperationException("default_desktop_required");
        var instance = GetModuleHandle(null);
        string name = "AbsorConnectOwnedInputLab_" + Process.GetCurrentProcess().Id;
        var windowClass = new OwnedWindowClass { procedure = Marshal.GetFunctionPointerForDelegate(ownedProcedure),
            instance = instance, background = new IntPtr(6), name = name };
        Check(RegisterClass(ref windowClass) != 0);
        OwnedPoint original = new OwnedPoint(), target = new OwnedPoint();
        bool moved = false, restored = false;
        try {
            ownedMouseDown = ownedMouseUp = ownedKeyDown = ownedKeyUp = ownedCharacters = 0;
            ownedWindow = CreateWindowEx(0, name, "AbsorConnect: prueba local de entrada", 0x00CF0000,
                Math.Max(0, (GetSystemMetrics(0) - 360) / 2), Math.Max(0, (GetSystemMetrics(1) - 200) / 2),
                360, 200, IntPtr.Zero, IntPtr.Zero, instance, IntPtr.Zero);
            Check(ownedWindow != IntPtr.Zero);
            ShowWindow(ownedWindow, 5); SetForegroundWindow(ownedWindow); SetFocus(ownedWindow);
            PumpOwnedUntil(delegate { return GetForegroundWindow() == ownedWindow && GetFocus() == ownedWindow; }, 4000);
            RequireOwnedForeground();
            if (elevatedTarget) {
                // Este proceso solo recibe; la entrada debe llegar de otro proceso del laboratorio.
                PumpOwnedUntil(delegate { return ownedMouseDown == 1 && ownedMouseUp == 1 &&
                    ownedKeyDown == 1 && ownedKeyUp == 1 && ownedCharacters == 1; }, 8000);
                RequireOwnedForeground();
                WriteReport("elevated-target-report.json", "{\"mouseDown\":" + ownedMouseDown +
                    ",\"mouseUp\":" + ownedMouseUp + ",\"keyDown\":" + ownedKeyDown +
                    ",\"keyUp\":" + ownedKeyUp + ",\"characters\":" + ownedCharacters +
                    ",\"highIntegrity\":true,\"fullElevationToken\":true,\"system\":false,\"processId\":" +
                    Process.GetCurrentProcess().Id + ",\"sessionId\":" + Process.GetCurrentProcess().SessionId + "}");
                // Conserva el destino durante la restauración del puntero por el emisor.
                Thread.Sleep(2000);
                return 0;
            }
            Check(GetCursorPos(out original));
            OwnedRect rect; Check(GetClientRect(ownedWindow, out rect));
            target = new OwnedPoint { x = (rect.right - rect.left) / 2, y = (rect.bottom - rect.top) / 2 };
            Check(ClientToScreen(ownedWindow, ref target));
            if (WindowFromPoint(target) != ownedWindow) throw new InvalidOperationException("owned_click_target_required");
            int left = GetSystemMetrics(76), top = GetSystemMetrics(77), width = GetSystemMetrics(78), height = GetSystemMetrics(79);
            if (width < 2 || height < 2 || target.x < left || target.x >= left + width || target.y < top || target.y >= top + height)
                throw new InvalidOperationException("owned_target_outside_display");
            RequireOwnedForeground();
            var motion = new Input { type = 0, data = new InputUnion { mouse = new MouseInput {
                x = (int)(((long)target.x - left) * 65535 / (width - 1)),
                y = (int)(((long)target.y - top) * 65535 / (height - 1)), flags = 0xC001 } } };
            moved = SendInput(1, new Input[] { motion }, Marshal.SizeOf(typeof(Input))) == 1;
            if (!moved) throw new InvalidOperationException("owned_mouse_move_failed");
            PumpOwnedUntil(delegate { OwnedPoint point; return GetCursorPos(out point) && point.x == target.x && point.y == target.y; }, 1000);
            if (WindowFromPoint(target) != ownedWindow) throw new InvalidOperationException("owned_click_target_changed");
            SendOwnedPair(new Input { type = 0, data = new InputUnion { mouse = new MouseInput { flags = 2 } } },
                new Input { type = 0, data = new InputUnion { mouse = new MouseInput { flags = 4 } } });
            PumpOwnedUntil(delegate { return ownedMouseDown == 1 && ownedMouseUp == 1; }, 1000);
            SendOwnedPair(new Input { type = 1, data = new InputUnion { keyboard = new KeyboardInput { scan = 65, flags = 4 } } },
                new Input { type = 1, data = new InputUnion { keyboard = new KeyboardInput { scan = 65, flags = 6 } } });
            PumpOwnedUntil(delegate { return ownedKeyDown == 1 && ownedKeyUp == 1 && ownedCharacters == 1; }, 1000);
            RequireOwnedForeground();
        } finally {
            // No pelea con una intervención local: restaura solo si conserva foco, escritorio y posición de prueba.
            try {
                OwnedPoint current;
                if (moved && GetForegroundWindow() == ownedWindow && InputDesktopName() == "Default" &&
                    GetCursorPos(out current) && current.x == target.x && current.y == target.y) {
                    Check(SetCursorPos(original.x, original.y));
                    restored = GetCursorPos(out current) && current.x == original.x && current.y == original.y;
                }
            } finally {
                if (ownedWindow != IntPtr.Zero && IsWindow(ownedWindow)) DestroyWindow(ownedWindow);
                ownedWindow = IntPtr.Zero; UnregisterClass(name, instance);
            }
        }
        if (!restored) throw new InvalidOperationException("owned_cursor_restore_not_verified");
        return 0;
    }


    [StructLayout(LayoutKind.Sequential)]
    struct TargetGuiInfo {
        public int size; public uint flags;
        public IntPtr active, focus, capture, menuOwner, moveSize, caret; public OwnedRect caretRect;
    }
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindow(string name, string title);
    [DllImport("user32.dll", SetLastError = true)] static extern bool GetGUIThreadInfo(uint thread, ref TargetGuiInfo info);
    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool GetTokenInformation(IntPtr token, int type, IntPtr buffer, int length, out int needed);

    static IntPtr TokenInformation(IntPtr token, int type) {
        int size; GetTokenInformation(token, type, IntPtr.Zero, 0, out size);
        if (size < 1 || size > 65536) throw new InvalidOperationException("invalid_token_info_size");
        IntPtr data = Marshal.AllocHGlobal(size);
        try { Check(GetTokenInformation(token, type, data, size, out size)); return data; }
        catch { Marshal.FreeHGlobal(data); throw; }
    }

    static void RequireHighToken(IntPtr token) {
        IntPtr elevation = TokenInformation(token, 18), integrity = IntPtr.Zero;
        try {
            integrity = TokenInformation(token, 25);
            string sid = new SecurityIdentifier(Marshal.ReadIntPtr(integrity)).Value;
            if (Marshal.ReadInt32(elevation) != 2 || sid != "S-1-16-12288")
                throw new InvalidOperationException("full_high_integrity_token_required");
        } finally { if (integrity != IntPtr.Zero) Marshal.FreeHGlobal(integrity); Marshal.FreeHGlobal(elevation); }
    }

    static void RequireElevatedTarget(ProcessInfo child, IntPtr window, int session) {
        uint pid;
        uint thread = GetWindowThreadProcessId(window, out pid);
        var gui = new TargetGuiInfo { size = Marshal.SizeOf(typeof(TargetGuiInfo)) };
        if (WaitForSingleObject(child.process, 0) != 258 || thread != child.threadId || pid != child.processId ||
            pid == Process.GetCurrentProcess().Id || !IsWindow(window) || GetForegroundWindow() != window ||
            !GetGUIThreadInfo(thread, ref gui) || gui.focus != window || gui.active != window ||
            InputDesktopName() != "Default" || DesktopName(GetThreadDesktop(GetCurrentThreadId())) != "Default" ||
            WTSGetActiveConsoleSessionId() != session)
            throw new InvalidOperationException("elevated_target_context_changed");
        for (int key = 1; key < 255; key++)
            if (GetAsyncKeyState(key) < 0) throw new InvalidOperationException("pressed_key_prevents_elevated_probe");
    }

    static void SendElevatedPair(ProcessInfo child, IntPtr window, int session, Input down, Input up) {
        RequireElevatedTarget(child, window, session);
        if (down.type == 0) {
            OwnedPoint point;
            if (!GetCursorPos(out point) || WindowFromPoint(point) != window)
                throw new InvalidOperationException("elevated_pointer_target_required");
        }
        uint sent = SendInput(2, new Input[] { down, up }, Marshal.SizeOf(typeof(Input)));
        if (sent != 2) {
            if (sent == 1) SendInput(1, new Input[] { up }, Marshal.SizeOf(typeof(Input)));
            throw new InvalidOperationException("elevated_input_pair_incomplete");
        }
    }

    static int ElevatedInput() {
        RequireInputLab();
        int session = Process.GetCurrentProcess().SessionId;
        if (WindowsIdentity.GetCurrent().User.Value != "S-1-5-18" || session == 0 || WTSGetActiveConsoleSessionId() != session)
            throw new InvalidOperationException("interactive_system_context_required");
        if (InputDesktopName() != "Default" || DesktopName(GetThreadDesktop(GetCurrentThreadId())) != "Default")
            throw new InvalidOperationException("default_desktop_required");
        IntPtr user = IntPtr.Zero, linked = IntPtr.Zero, childToken = IntPtr.Zero;
        ProcessInfo child = new ProcessInfo();
        IntPtr window = IntPtr.Zero;
        OwnedPoint original = new OwnedPoint(), target = new OwnedPoint();
        bool moved = false, restored = false;
        try {
            Check(WTSQueryUserToken((uint)session, out user));
            IntPtr info = TokenInformation(user, 19);
            try { linked = Marshal.ReadIntPtr(info); } finally { Marshal.FreeHGlobal(info); }
            RequireHighToken(linked);
            string binary = Assembly.GetExecutingAssembly().Location;
            var startup = new StartupInfo { cb = Marshal.SizeOf(typeof(StartupInfo)), desktop = @"winsta0\default", flags = 1, show = 5 };
            // SYSTEM ya autorizado crea solo el receptor fijo con el token alto del usuario; no prueba consentimiento UAC.
            Check(CreateProcessAsUser(linked, binary, new StringBuilder("\"" + binary + "\" --elevated-input-target"),
                IntPtr.Zero, IntPtr.Zero, false, 0x08000000, IntPtr.Zero, Path.GetDirectoryName(binary), ref startup, out child));
            Check(OpenProcessToken(child.process, 8, out childToken));
            RequireHighToken(childToken);
            using (var targetIdentity = new WindowsIdentity(childToken))
            using (var userIdentity = new WindowsIdentity(user))
                if (!targetIdentity.User.Equals(userIdentity.User) || targetIdentity.User.Value == "S-1-5-18")
                    throw new InvalidOperationException("elevated_target_user_mismatch");
            var wait = Stopwatch.StartNew();
            while (window == IntPtr.Zero || GetForegroundWindow() != window) {
                if (wait.ElapsedMilliseconds > 4500 || WaitForSingleObject(child.process, 0) != 258)
                    throw new InvalidOperationException("elevated_target_unavailable");
                window = FindWindow("AbsorConnectOwnedInputLab_" + child.processId, null); Thread.Sleep(20);
            }
            RequireElevatedTarget(child, window, session);
            Check(GetCursorPos(out original));
            OwnedRect rect; Check(GetClientRect(window, out rect));
            target = new OwnedPoint { x = (rect.right - rect.left) / 2, y = (rect.bottom - rect.top) / 2 };
            Check(ClientToScreen(window, ref target));
            if (WindowFromPoint(target) != window) throw new InvalidOperationException("elevated_click_target_required");
            int left = GetSystemMetrics(76), top = GetSystemMetrics(77), width = GetSystemMetrics(78), height = GetSystemMetrics(79);
            if (width < 2 || height < 2 || target.x < left || target.x >= left + width || target.y < top || target.y >= top + height)
                throw new InvalidOperationException("elevated_target_outside_display");
            RequireElevatedTarget(child, window, session);
            moved = SendInput(1, new Input[] { new Input { type = 0, data = new InputUnion { mouse = new MouseInput {
                x = (int)(((long)target.x - left) * 65535 / (width - 1)),
                y = (int)(((long)target.y - top) * 65535 / (height - 1)), flags = 0xC001 } } } }, Marshal.SizeOf(typeof(Input))) == 1;
            if (!moved) throw new InvalidOperationException("elevated_mouse_move_failed");
            var motionWait = Stopwatch.StartNew(); OwnedPoint current;
            while (!GetCursorPos(out current) || current.x != target.x || current.y != target.y) {
                if (motionWait.ElapsedMilliseconds > 1000) throw new InvalidOperationException("elevated_mouse_observation_timeout");
                RequireElevatedTarget(child, window, session); Thread.Sleep(10);
            }
            SendElevatedPair(child, window, session,
                new Input { type = 0, data = new InputUnion { mouse = new MouseInput { flags = 2 } } },
                new Input { type = 0, data = new InputUnion { mouse = new MouseInput { flags = 4 } } });
            SendElevatedPair(child, window, session,
                new Input { type = 1, data = new InputUnion { keyboard = new KeyboardInput { scan = 65, flags = 4 } } },
                new Input { type = 1, data = new InputUnion { keyboard = new KeyboardInput { scan = 65, flags = 6 } } });
            RequireElevatedTarget(child, window, session);
            if (GetCursorPos(out current) && current.x == target.x && current.y == target.y) {
                Check(SetCursorPos(original.x, original.y));
                restored = GetCursorPos(out current) && current.x == original.x && current.y == original.y;
            }
            if (!restored) throw new InvalidOperationException("elevated_cursor_restore_not_verified");
            if (WaitForSingleObject(child.process, 7000) != 0) throw new InvalidOperationException("elevated_receiver_timeout");
            uint code; Check(GetExitCodeProcess(child.process, out code));
            if (code != 0) throw new InvalidOperationException("elevated_receiver_failed_" + code);
            WriteReport("elevated-input-report.json", "{\"schema\":1,\"senderSystem\":true,\"separateProcesses\":true,\"senderProcessId\":" +
                Process.GetCurrentProcess().Id + ",\"receiverProcessId\":" + child.processId + ",\"sessionId\":" + session + "," +
                "\"targetFullHighIntegrityUser\":true,\"receiverExitCode\":0,\"cursorRestored\":true," +
                "\"uacConsentTested\":false,\"credentialsTested\":false,\"readyForUnattended\":false}");
            return 0;
        } finally {
            try {
                OwnedPoint current;
                if (moved && !restored && window != IntPtr.Zero && GetForegroundWindow() == window && InputDesktopName() == "Default" &&
                    GetCursorPos(out current) && current.x == target.x && current.y == target.y) SetCursorPos(original.x, original.y);
            } finally {
                if (child.process != IntPtr.Zero) {
                    if (WaitForSingleObject(child.process, 0) == 258) { TerminateProcess(child.process, 124); WaitForSingleObject(child.process, 2000); }
                    CloseHandle(child.thread); CloseHandle(child.process);
                }
                if (childToken != IntPtr.Zero) CloseHandle(childToken);
                if (linked != IntPtr.Zero) CloseHandle(linked);
                if (user != IntPtr.Zero) CloseHandle(user);
            }
        }
    }


    // UI Automation se limita a foco, PID, tipo e IsPassword; nunca consulta Name, Value ni texto.
    sealed class FocusSnapshot {
        public int[] runtimeId; public int controlType; public bool password;
    }
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool IsDialogMessage(IntPtr window, ref OwnedMessage message);

    static bool SameFocus(int[] left, int[] right) {
        if (left == null || right == null || left.Length != right.Length) return false;
        for (int i = 0; i < left.Length; i++) if (left[i] != right[i]) return false;
        return true;
    }

    static uint RequireFocusContext(bool logon) {
        RequireInputLab();
        int session = Process.GetCurrentProcess().SessionId;
        bool system = WindowsIdentity.GetCurrent().User.Value == "S-1-5-18";
        if (session == 0 || WTSGetActiveConsoleSessionId() != session || system != logon)
            throw new InvalidOperationException("focus_probe_token_context_required");
        string desktop = logon ? "Winlogon" : "Default";
        if (InputDesktopName() != desktop || DesktopName(GetThreadDesktop(GetCurrentThreadId())) != desktop)
            throw new InvalidOperationException("focus_probe_desktop_required");
        uint pid;
        if (GetWindowThreadProcessId(GetForegroundWindow(), out pid) == 0)
            throw new InvalidOperationException("focus_foreground_unavailable");
        if (logon) {
            using (var process = Process.GetProcessById(checked((int)pid)))
                if (!String.Equals(process.MainModule.FileName, Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),
                    "LogonUI.exe"), StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("logon_foreground_required");
        } else if (pid != Process.GetCurrentProcess().Id) throw new InvalidOperationException("own_focus_window_required");
        for (int key = 1; key < 255; key++)
            if (GetAsyncKeyState(key) < 0) throw new InvalidOperationException("pressed_key_prevents_focus_probe");
        return pid;
    }

    static FocusSnapshot FocusedSnapshot(uint expectedPid) {
        var element = System.Windows.Automation.AutomationElement.FocusedElement;
        if (element == null) throw new InvalidOperationException("uia_focus_unavailable");
        var current = element.Current;
        if (current.ProcessId != expectedPid) throw new InvalidOperationException("uia_focus_process_mismatch");
        int[] id = element.GetRuntimeId();
        if (id == null || id.Length == 0) throw new InvalidOperationException("uia_focus_identity_unavailable");
        return new FocusSnapshot { runtimeId = id, controlType = current.ControlType.Id, password = current.IsPassword };
    }

    static FocusSnapshot WaitFocus(bool logon, uint pid, int[] previous, bool equal) {
        var timer = Stopwatch.StartNew();
        do {
            if (RequireFocusContext(logon) != pid) throw new InvalidOperationException("focus_foreground_changed");
            var value = FocusedSnapshot(pid);
            if (SameFocus(previous, value.runtimeId) == equal) return value;
            Thread.Sleep(25);
        } while (timer.ElapsedMilliseconds < 2000);
        throw new InvalidOperationException("focus_transition_not_observed");
    }

    static void SendFocusNavigation(bool logon, uint pid, int[] expectedFocus, bool backward) {
        if (RequireFocusContext(logon) != pid || !SameFocus(expectedFocus, FocusedSnapshot(pid).runtimeId))
            throw new InvalidOperationException("focus_changed_before_input");
        var tabDown = new Input { type = 1, data = new InputUnion { keyboard = new KeyboardInput { key = 9 } } };
        var tabUp = new Input { type = 1, data = new InputUnion { keyboard = new KeyboardInput { key = 9, flags = 2 } } };
        var shiftUp = new Input { type = 1, data = new InputUnion { keyboard = new KeyboardInput { key = 16, flags = 2 } } };
        Input[] events = backward ? new Input[] {
            new Input { type = 1, data = new InputUnion { keyboard = new KeyboardInput { key = 16 } } }, tabDown, tabUp, shiftUp
        } : new Input[] { tabDown, tabUp };
        uint sent = SendInput((uint)events.Length, events, Marshal.SizeOf(typeof(Input)));
        if (sent != events.Length) {
            // Libera solo las teclas sintéticas que hayan podido quedar pulsadas.
            if ((!backward && sent == 1) || (backward && sent == 2)) SendInput(1, new Input[] { tabUp }, Marshal.SizeOf(typeof(Input)));
            if (backward && sent > 0 && sent < 4) SendInput(1, new Input[] { shiftUp }, Marshal.SizeOf(typeof(Input)));
            throw new InvalidOperationException("focus_navigation_input_incomplete");
        }
    }

    static string FocusNavigation(bool logon) {
        uint pid = RequireFocusContext(logon);
        var before = FocusedSnapshot(pid);
        if (before.controlType != System.Windows.Automation.ControlType.Edit.Id || !before.password)
            throw new InvalidOperationException("password_control_focus_required");
        SendFocusNavigation(logon, pid, before.runtimeId, false);
        var after = WaitFocus(logon, pid, before.runtimeId, false);
        SendFocusNavigation(logon, pid, after.runtimeId, true);
        var restored = WaitFocus(logon, pid, before.runtimeId, true);
        if (!restored.password || restored.controlType != before.controlType)
            throw new InvalidOperationException("focus_restore_metadata_mismatch");
        return "{\"schema\":1,\"desktop\":\"" + (logon ? "Winlogon" : "Default") +
            "\",\"focusChanged\":true,\"focusRestored\":true,\"eventsInserted\":6,\"beforeControlType\":" + before.controlType +
            ",\"afterControlType\":" + after.controlType + ",\"passwordControlBefore\":true," +
            "\"receptionObservedBy\":\"uia_runtime_id_comparison\",\"credentialsRead\":false,\"credentialsWritten\":false," +
            "\"readyForUnattended\":false}";
    }

    static string FocusSelf() {
        RequireInputLab();
        if (WindowsIdentity.GetCurrent().User.Value == "S-1-5-18" || Process.GetCurrentProcess().SessionId == 0 ||
            new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator))
            throw new InvalidOperationException("filtered_user_context_required");
        Exception uiFailure = null;
        using (var ready = new ManualResetEvent(false))
        using (var stop = new ManualResetEvent(false)) {
            var ui = new Thread(delegate() {
                IntPtr window = IntPtr.Zero, instance = GetModuleHandle(null);
                string name = "AbsorConnectFocusLab_" + Process.GetCurrentProcess().Id;
                bool registered = false;
                try {
                    var value = new OwnedWindowClass { procedure = Marshal.GetFunctionPointerForDelegate(ownedProcedure),
                        instance = instance, background = new IntPtr(6), name = name };
                    Check(RegisterClass(ref value) != 0); registered = true;
                    window = CreateWindowEx(0x10000, name, "AbsorConnect: prueba de foco sin texto", 0x00CF0000,
                        100, 100, 380, 220, IntPtr.Zero, IntPtr.Zero, instance, IntPtr.Zero);
                    Check(window != IntPtr.Zero);
                    // Edit vacío de solo lectura y con atributo de contraseña: no admite contenido del usuario.
                    var edit = CreateWindowEx(0, "EDIT", "", 0x50810820, 30, 40, 260, 28, window, new IntPtr(1), instance, IntPtr.Zero);
                    var button = CreateWindowEx(0, "BUTTON", "Solo foco", 0x50010000, 30, 90, 130, 28, window, new IntPtr(2), instance, IntPtr.Zero);
                    Check(edit != IntPtr.Zero && button != IntPtr.Zero);
                    ShowWindow(window, 5); SetForegroundWindow(window); SetFocus(edit); ready.Set();
                    var lifetime = Stopwatch.StartNew();
                    while (!stop.WaitOne(10) && IsWindow(window) && lifetime.ElapsedMilliseconds < 12000) {
                        OwnedMessage message;
                        while (PeekMessage(out message, IntPtr.Zero, 0, 0, 1)) {
                            if (!IsDialogMessage(window, ref message)) { TranslateMessage(ref message); DispatchMessage(ref message); }
                        }
                    }
                } catch (Exception error) { uiFailure = error; ready.Set(); }
                finally {
                    if (window != IntPtr.Zero && IsWindow(window)) DestroyWindow(window);
                    if (registered) UnregisterClass(name, instance);
                }
            });
            ui.IsBackground = true; ui.SetApartmentState(ApartmentState.STA); ui.Start();
            try {
                if (!ready.WaitOne(4000)) throw new InvalidOperationException("focus_self_window_timeout");
                if (uiFailure != null) throw uiFailure;
                // Cliente UIA en este hilo MTA; la ventana y su cola viven en otro hilo STA.
                return FocusNavigation(false);
            } finally { stop.Set(); if (!ui.Join(2000)) throw new InvalidOperationException("focus_self_cleanup_timeout"); }
        }
    }

    public static int Main(string[] args) {
        if (args.Length != 1) return 64;
        try {
            if (args[0] == "--launch-focus-self-probe") return Launch(ProbeMode.FocusSelf);
            if (args[0] == "--focus-navigation-self") { FocusSelf(); return 0; }
            if (args[0] == "--launch-logon-focus-probe") return Launch(ProbeMode.LogonFocus);
            if (args[0] == "--logon-focus-coordinator") {
                RequireInputLab(); Console.WriteLine(RunSecureProbe(SecureProbeMode.LogonFocus)); return 0;
            }
            if (args[0] == "--launch-lock-escape-probe") return Launch(ProbeMode.LockEscape);
            if (args[0] == "--lock-escape-coordinator") {
                RequireInputLab(); Console.WriteLine(RunSecureProbe(SecureProbeMode.LogonEscape)); return 0;
            }
            if (args[0] == "--launch-elevated-input-probe") return Launch(ProbeMode.ElevatedInput);
            if (args[0] == "--elevated-input-injector") return ElevatedInput();
            if (args[0] == "--elevated-input-target") return OwnedInput(false, true);
            if (args[0] == "--launch-console-probe") return Launch();
            if (args[0] == "--launch-uac-probe") return Launch(ProbeMode.Elevation);
            if (args[0] == "--launch-uac-input-probe") return Launch(ProbeMode.UacInput);
            if (args[0] == "--launch-user-owned-input-probe") return Launch(ProbeMode.OwnUser);
            if (args[0] == "--launch-system-owned-input-probe") return Launch(ProbeMode.OwnSystem);
            if (args[0] == "--owned-input-user") return OwnedInput(true);
            if (args[0] == "--owned-input-system") return OwnedInput(false);
            if (args[0] == "--request-elevation") return RequestElevation();
            if (args[0] == "--elevated-self-check") {
                // Si se autoriza manualmente, solo comprueba el contexto y termina, sin modificar nada.
                return new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator) ? 0 : 3;
            }
            bool testUacInput = args[0] == "--uac-input";
            bool escapeUac = args[0] == "--escape-uac";
            bool escapeLogon = args[0] == "--escape-logon";
            bool logonFocus = args[0] == "--logon-focus";
            if (args[0] != "--capture" && !testUacInput && !escapeUac && !escapeLogon && !logonFocus) return 64;
            string reportName = logonFocus ? "logon-focus-report.json" : escapeLogon ? "lock-escape-report.json" : testUacInput ? "uac-input-report.json" :
                escapeUac ? "escape-report.json" : "capture-report.json";
            string report = null; Exception failure = null;
            var thread = new Thread(delegate() { try { report = logonFocus ? FocusNavigation(true) : testUacInput ? UacInput() : escapeUac || escapeLogon ? EscapeUac(escapeLogon) : Capture(); } catch (Exception e) { failure = e; } });
            thread.IsBackground = true; thread.Start();
            if (!thread.Join(testUacInput ? 45000 : 10000)) throw new InvalidOperationException("probe_timeout");
            if (failure != null) {
                if (testUacInput || escapeUac || escapeLogon || logonFocus) {
                    string message = failure.Message.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", " ").Replace("\n", " ");
                    WriteReport(reportName, "{\"status\":\"input_probe_failed\",\"error\":\"" + message +
                        "\",\"cleanupAttempted\":" + (cleanupAttempted ? "true" : "false") + ",\"cleanupDefaultObserved\":" + (cleanupDefaultObserved ? "true" : "false") +
                        ",\"inputTested\":false,\"readyForUnattended\":false}");
                }
                throw failure;
            }
            // Una ejecución no pisa informes anteriores. La carpeta debe estar protegida antes de compilar.
            WriteReport(reportName, report);
            return 0;
        } catch (Exception error) {
            Console.Error.WriteLine(error.GetType().Name + ": " + error.Message); return 3;
        }
    }
}
