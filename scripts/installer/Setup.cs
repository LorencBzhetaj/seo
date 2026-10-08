// Instaluesi Windows i SEO Tool (Setup.exe), i përpiluar nga scripts/build-installer.mjs me csc.exe të
// .NET Framework 4.x (pjesë e Windows 10/11; s'shkarkohet asnjë mjet). Përmban ZIP-in e programit si burim
// (payload.zip) dhe e nxjerr në një dosje anësore (<dosja>.setup-new); vetëm kur paketa është e plotë, programi
// aktual zhvendoset te <dosja>.setup-old dhe dosja e re zë vendin e tij (dy riemërtime në të njëjtin disk).
// Një ndërprerje (mbyllje me forcë, rënie e rrymës) lë programin e vjetër të plotë; nisja tjetër e
// instaluesit i pastron ose i rikthen mbetjet (Recover). Pastaj thërret logjikën ekzistuese të instalimit
// (app\dist\app\setup.js install): shkurtorja në Start Menu, regjistrimi te "Aplikacionet" për çinstalim,
// heqja e skedarëve të vjetër të programit. Pa administrator (instalim për përdoruesin aktual).
// Të dhënat e përdoruesit (%LOCALAPPDATA%\SEO Tool: raportet, pamjet, Search Console) s'preken kurrë.
//
// Pa ndërfaqe:  Setup.exe /S [/DIR=<dosja>] [/DESKTOP] [/OPEN] [/KEEPPREVIOUS] [/LOG=<skedar>]
//               /KEEPPREVIOUS: s'hiq programin e regjistruar më parë në një dosje tjetër
// Kodet: 0 ok · 2 dosje e papranueshme · 3 programi është i hapur · 4 skedarë me shenjë interneti ·
//        5 shkurtorja s'u krijua · 10 nxjerrja dështoi · 11 anuluar · 12 node/setup mungon
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("SEO Tool Setup")]
[assembly: AssemblyProduct("SEO Tool")]
[assembly: AssemblyDescription("Instaluesi i SEO Tool (auditim lokal i website-eve)")]
[assembly: AssemblyVersion(SeoToolSetup.Info.AssemblyVersion)]
[assembly: AssemblyFileVersion(SeoToolSetup.Info.AssemblyVersion)]
[assembly: AssemblyInformationalVersion(SeoToolSetup.Info.Version)]

namespace SeoToolSetup
{
    internal static partial class Info { }

    internal sealed class Options
    {
        public bool Silent;
        public string Dir;
        public bool Desktop;
        public bool Open;
        public bool KeepPrevious;
        public string LogFile;
        public List<string> Unknown = new List<string>();
    }

    internal static class Installer
    {
        public const string AppName = "SEO Tool";
        public const string RegKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\SEOTool";

        public static string DataDir()
        {
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), AppName);
        }

        public static string PreviousInstallDir()
        {
            try
            {
                using (RegistryKey k = Registry.CurrentUser.OpenSubKey(RegKey))
                {
                    object v = k == null ? null : k.GetValue("InstallLocation");
                    string s = v as string;
                    return string.IsNullOrEmpty(s) ? null : s;
                }
            }
            catch { return null; }
        }

        public static string DefaultDir()
        {
            string prev = PreviousInstallDir();
            if (prev != null && File.Exists(Path.Combine(prev, @"runtime\node.exe"))) return prev;
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Programs\" + AppName);
        }

        static string Norm(string p)
        {
            return Path.GetFullPath(p).TrimEnd('\\').ToLowerInvariant();
        }

        static bool Inside(string dir, string parent)
        {
            string d = Norm(dir), p = Norm(parent);
            return d == p || d.StartsWith(p + "\\");
        }

        public static bool SameDir(string a, string b)
        {
            try { return Norm(a) == Norm(b); } catch { return false; }
        }

        /// Arsyeja pse dosja s'pranohet (null = në rregull). setup.js e kontrollon sërish.
        public static string DirProblem(string dir)
        {
            if (string.IsNullOrWhiteSpace(dir)) return "Zgjidh dosjen e instalimit.";
            string full;
            try { full = Path.GetFullPath(dir); } catch { return "Shteg i pavlefshëm."; }
            if (!Path.IsPathRooted(dir)) return "Shkruaj shtegun e plotë (p.sh. C:\\Programe\\SEO Tool).";
            if (Norm(full) == Norm(Path.GetPathRoot(full))) return "Mos e instalo direkt në rrënjën e diskut; zgjidh një dosje.";
            if (Inside(full, DataDir())) return "Kjo është dosja e të dhënave (" + DataDir() + "); zgjidh një dosje tjetër për programin.";
            if (Inside(full, Path.GetTempPath())) return "Mos e instalo në dosjen e përkohshme.";
            string win = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
            if (!string.IsNullOrEmpty(win) && Inside(full, win)) return "Mos e instalo brenda dosjes së Windows.";
            if (Directory.Exists(full))
            {
                bool ours = File.Exists(Path.Combine(full, "version.txt")) || File.Exists(Path.Combine(full, @"runtime\node.exe"));
                bool empty = Directory.GetFileSystemEntries(full).Length == 0;
                if (!ours && !empty) return "Dosja ekziston dhe s'është bosh (dhe s'është një instalim i SEO Tool). Zgjidh një dosje bosh ose shto \\SEO Tool në fund.";
            }
            return null;
        }

        /// Procese që ekzekutohen nga dosja e instalimit (p.sh. runtime\node.exe i programit të hapur).
        public static List<string> RunningFrom(string dir)
        {
            List<string> found = new List<string>();
            if (!Directory.Exists(dir)) return found;
            foreach (Process p in Process.GetProcesses())
            {
                try
                {
                    string f = p.MainModule.FileName;
                    if (f != null && Inside(f, dir)) found.Add(p.ProcessName + " (" + p.Id + ")");
                }
                catch { /* procese të sistemit ose të përdoruesve të tjerë */ }
                finally { p.Dispose(); }
            }
            return found;
        }

        /// Emrat e programit në rrënjë të dosjes (si OWNED te setup.ts); gjithçka tjetër i përket përdoruesit.
        static readonly string[] Owned = { "runtime", "app", "Instalo.cmd", "Hap SEO Tool.cmd", "seo-audit.cmd", "LEXOME.txt", "version.txt" };

        public static string StagingDir(string dir) { return Path.GetFullPath(dir).TrimEnd('\\') + ".setup-new"; }
        public static string BackupDir(string dir) { return Path.GetFullPath(dir).TrimEnd('\\') + ".setup-old"; }

        /// Fshin një dosje të tërë (edhe skedarë vetëm-për-lexim), me disa riprovime për antivirusin/indeksimin.
        static void DeleteTree(string path)
        {
            for (int i = 0; ; i++)
            {
                try
                {
                    if (!Directory.Exists(path)) return;
                    foreach (string f in Directory.GetFiles(path, "*", SearchOption.AllDirectories)) File.SetAttributes(f, FileAttributes.Normal);
                    Directory.Delete(path, true);
                    return;
                }
                catch (IOException) { if (i >= 4) throw; Thread.Sleep(400); }
                catch (UnauthorizedAccessException) { if (i >= 4) throw; Thread.Sleep(400); }
            }
        }

        static void MoveDir(string from, string to)
        {
            for (int i = 0; ; i++)
            {
                try { Directory.Move(from, to); return; }
                catch (IOException) { if (i >= 4) throw; Thread.Sleep(500); }
                catch (UnauthorizedAccessException) { if (i >= 4) throw; Thread.Sleep(500); }
            }
        }

        /// Skedarët e përdoruesit (çdo gjë që s'është pjesë e programit) kalojnë nga versioni i vjetër te i riu.
        static void MoveUserEntries(string from, string to, Action<string> log)
        {
            HashSet<string> owned = new HashSet<string>(Owned, StringComparer.OrdinalIgnoreCase);
            foreach (string e in Directory.GetFileSystemEntries(to)) owned.Add(Path.GetFileName(e));
            foreach (string e in Directory.GetFileSystemEntries(from))
            {
                string name = Path.GetFileName(e);
                if (owned.Contains(name)) continue;
                string dest = Path.Combine(to, name);
                if (File.Exists(dest) || Directory.Exists(dest)) continue;
                if (Directory.Exists(e)) Directory.Move(e, dest); else File.Move(e, dest);
                log("U ruajt skedari yt: " + name);
            }
        }

        static bool HasUserEntries(string dir)
        {
            HashSet<string> owned = new HashSet<string>(Owned, StringComparer.OrdinalIgnoreCase);
            foreach (string e in Directory.GetFileSystemEntries(dir)) if (!owned.Contains(Path.GetFileName(e))) return true;
            return false;
        }

        /// Pastron mbetjet e një instalimi të ndërprerë. Kthen null kur gjithçka është në rregull, përndryshe arsyen.
        ///  · <dosja>.setup-new: nxjerrje e papërfunduar → fshihet (programi në <dosja> s'u prek).
        ///  · <dosja>.setup-old pa <dosja>: ndërprerje mes dy riemërtimeve → versioni i vjetër rikthehet.
        ///  · <dosja>.setup-old me <dosja> të plotë: ndërrimi u krye → skedarët e përdoruesit kalojnë, i vjetri fshihet.
        public static string Recover(string dir, Action<string> log)
        {
            string full = Path.GetFullPath(dir).TrimEnd('\\');
            string staging = StagingDir(full), backup = BackupDir(full);
            if (Directory.Exists(backup))
            {
                if (Directory.Exists(full) && Directory.GetFileSystemEntries(full).Length == 0) Directory.Delete(full);
                if (!Directory.Exists(full))
                {
                    MoveDir(backup, full);
                    log("U rikthye versioni i mëparshëm nga një instalim i ndërprerë.");
                }
                else if (File.Exists(Path.Combine(full, "version.txt")) && File.Exists(Path.Combine(full, @"runtime\node.exe")))
                {
                    MoveUserEntries(backup, full, log);
                    if (HasUserEntries(backup)) return "Te " + backup + " mbetën skedarë që s'u zhvendosën; s'u fshi asgjë. Zhvendosi vetë dhe provo përsëri.";
                    DeleteTree(backup);
                    log("U hoq kopja e versionit të mëparshëm.");
                }
                else return "Gjendje e papritur: ekzistojnë edhe " + full + " edhe " + backup + ". S'u ndryshua asgjë; kontrollo dosjet.";
            }
            if (Directory.Exists(staging))
            {
                DeleteTree(staging);
                log("U fshi një nxjerrje e papërfunduar nga një instalim i ndërprerë.");
            }
            return null;
        }

        /// Nxjerr payload.zip ("SEO Tool/..." → staging\...), me kontroll shtegu për çdo skedar.
        public static int Extract(string staging, Action<string> log, Action<int, int> progress, Func<bool> cancelled)
        {
            Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip");
            if (s == null) { log("Paketa e programit mungon brenda instaluesit."); return 10; }
            string root = Path.GetFullPath(staging).TrimEnd('\\') + "\\";
            using (s)
            using (ZipArchive zip = new ZipArchive(s, ZipArchiveMode.Read))
            {
                int total = zip.Entries.Count, n = 0;
                foreach (ZipArchiveEntry e in zip.Entries)
                {
                    if (cancelled != null && cancelled()) { log("Instalimi u anulua; programi ekzistues s'u prek."); return 11; }
                    n++;
                    string name = e.FullName.Replace('/', '\\');
                    int cut = name.IndexOf('\\');
                    if (cut < 0) continue;
                    string rel = name.Substring(cut + 1);
                    if (rel.Length == 0) continue;
                    string target = Path.GetFullPath(Path.Combine(root, rel));
                    if (!target.StartsWith(root, StringComparison.OrdinalIgnoreCase)) { log("Shteg i papritur në paketë: " + e.FullName); return 10; }
                    if (name.EndsWith("\\")) { Directory.CreateDirectory(target); continue; }
                    Directory.CreateDirectory(Path.GetDirectoryName(target));
                    e.ExtractToFile(target, true);
                    if (progress != null && (n % 200 == 0 || n == total)) progress(n, total);
                }
            }
            if (!File.Exists(Path.Combine(root, "version.txt")) || !File.Exists(Path.Combine(root, @"runtime\node.exe"))) { log("Paketa e nxjerrë s'është e plotë."); return 10; }
            return 0;
        }

        /// Ndërrimi: <dosja> → <dosja>.setup-old, <dosja>.setup-new → <dosja>; pastaj skedarët e përdoruesit kalojnë te i riu.
        static int Swap(string dir, string staging, Action<string> log)
        {
            string backup = BackupDir(dir);
            bool had = Directory.Exists(dir);
            if (had)
            {
                try { MoveDir(dir, backup); }
                catch (Exception e)
                {
                    log("Programi ekzistues s'u zhvendos (" + e.Message + "). Ndoshta një dritare ose program e mban hapur dosjen. S'u ndryshua asgjë.");
                    try { DeleteTree(staging); } catch { }
                    return 3;
                }
            }
            try { MoveDir(staging, dir); }
            catch (Exception e)
            {
                log("Versioni i ri s'u vendos (" + e.Message + ").");
                if (had) { MoveDir(backup, dir); log("U rikthye versioni i mëparshëm."); }
                return 10;
            }
            if (!had) return 0;
            string problem;
            try { problem = Recover(dir, log); }
            catch (Exception e) { problem = "Kopja e versionit të mëparshëm s'u fshi tani (" + e.Message + "); pastrohet në nisjen tjetër të instaluesit."; }
            if (problem != null) log(problem);
            return 0;
        }

        /// Logjika e instalimit të programit (shkurtorja, regjistrimi, pastrimi): app\dist\app\setup.js install.
        public static int RunSetupJs(string dir, Options o, Action<string> log)
        {
            string node = Path.Combine(dir, @"runtime\node.exe");
            string setup = Path.Combine(dir, @"app\dist\app\setup.js");
            if (!File.Exists(node) || !File.Exists(setup)) { log("node.exe ose setup.js mungon pas nxjerrjes."); return 12; }
            ProcessStartInfo psi = new ProcessStartInfo(node, "\"" + setup + "\" install --yes " + (o.Desktop ? "--desktop" : "--no-desktop") + " " + (o.Open ? "--open" : "--no-open") + (o.KeepPrevious ? " --keep-previous" : ""));
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.StandardOutputEncoding = Encoding.UTF8;
            psi.StandardErrorEncoding = Encoding.UTF8;
            psi.WorkingDirectory = dir;
            using (Process p = Process.Start(psi))
            {
                p.OutputDataReceived += delegate(object _, DataReceivedEventArgs a) { if (a.Data != null) log(a.Data); };
                p.ErrorDataReceived += delegate(object _, DataReceivedEventArgs a) { if (a.Data != null) log(a.Data); };
                p.BeginOutputReadLine();
                p.BeginErrorReadLine();
                p.WaitForExit();
                return p.ExitCode;
            }
        }

        public static int Run(Options o, Action<string> log, Action<int, int> progress, Func<bool> cancelled, Action committing)
        {
            string dir = Path.GetFullPath(o.Dir).TrimEnd('\\');
            log(AppName + " " + Info.Version + " → " + dir);
            string problem = DirProblem(dir);
            if (problem != null) { log(problem); return 2; }
            List<string> running = RunningFrom(dir);
            running.AddRange(RunningFrom(BackupDir(dir)));
            if (running.Count > 0) { log(AppName + " është i hapur nga kjo dosje (" + string.Join(", ", running.ToArray()) + "). Mbyll dritaren e tij dhe provo përsëri."); return 3; }
            string left;
            try { left = Recover(dir, log); }
            catch (Exception e) { left = "Mbetjet e një instalimi të mëparshëm s'u pastruan: " + e.Message; }
            if (left != null) { log(left); return 10; }
            string staging = StagingDir(dir);
            string parent = Path.GetDirectoryName(dir);
            if (!string.IsNullOrEmpty(parent)) Directory.CreateDirectory(parent);
            log("Po nxirren skedarët në një dosje anësore (programi ekzistues s'preket deri në fund)…");
            int x;
            try { x = Extract(staging, log, progress, cancelled); }
            catch (Exception e) { log("Nxjerrja dështoi: " + e.Message); x = 10; }
            if (x != 0)
            {
                try { DeleteTree(staging); } catch (Exception e) { log("Dosja anësore s'u fshi tani (" + e.Message + "); fshihet në nisjen tjetër."); }
                return x;
            }
            if (committing != null) committing();
            log("Po zëvendësohet programi…");
            x = Swap(dir, staging, log);
            if (x != 0) return x;
            log("Po krijohet shkurtorja dhe regjistrimi…");
            return RunSetupJs(dir, o, log);
        }
    }

    internal sealed class SetupForm : Form
    {
        readonly TextBox dirBox = new TextBox();
        readonly CheckBox desktop = new CheckBox();
        readonly CheckBox open = new CheckBox();
        readonly TextBox output = new TextBox();
        readonly Button install = new Button();
        readonly Button close = new Button();
        readonly Button browse = new Button();
        readonly Label status = new Label();
        volatile bool installing;
        volatile bool cancelRequested;
        volatile bool committed;

        public SetupForm()
        {
            // Rregullim automatik (TableLayoutPanel + AutoSize): asnjë pozicion absolut, që teksti të mos pritet
            // në ekrane me DPI të lartë. Gjerësitë jepen në njësi 96 DPI dhe shkallëzohen me DPI-në e ekranit.
            float scale;
            using (Graphics g = CreateGraphics()) scale = g.DpiX / 96f;
            Func<int, int> S = delegate(int v) { return (int)Math.Round(v * scale); };
            Text = "Instalimi i " + Installer.AppName + " " + Info.Version;
            Font = new Font("Segoe UI", 9.5f);
            AutoScaleMode = AutoScaleMode.None;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            AutoSize = true;
            AutoSizeMode = AutoSizeMode.GrowAndShrink;
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

            TableLayoutPanel t = new TableLayoutPanel { ColumnCount = 2, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, Padding = new Padding(S(18)) };
            t.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            t.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            int wide = S(580);
            Action<Control, int> row = delegate(Control c, int span) { t.Controls.Add(c); t.SetColumnSpan(c, span); };
            Func<string, Label> text = delegate(string s) { return new Label { Text = s, AutoSize = true, MaximumSize = new Size(wide, 0), Margin = new Padding(0, S(4), 0, S(6)) }; };

            Label title = new Label { Text = Installer.AppName + " " + Info.Version, Font = new Font("Segoe UI Semibold", 15f), AutoSize = true, Margin = new Padding(0, 0, 0, S(4)) };
            row(title, 2);
            row(text("Auditim lokal i website-eve. Instalohet vetëm për këtë përdorues, pa të drejta administratori."), 2);
            Label dirLabel = text("Dosja e instalimit:");
            dirLabel.Margin = new Padding(0, S(10), 0, S(2));
            row(dirLabel, 2);
            dirBox.Text = Installer.DefaultDir(); dirBox.Width = S(470); dirBox.AccessibleName = "Dosja e instalimit"; dirBox.Margin = new Padding(0, S(3), S(8), 0);
            browse.Text = "Ndrysho…"; browse.AutoSize = true; browse.Padding = new Padding(S(8), S(2), S(8), S(2)); browse.Margin = new Padding(0);
            browse.Click += delegate { Browse(); };
            t.Controls.Add(dirBox);
            t.Controls.Add(browse);
            desktop.Text = "Shkurtore edhe në Desktop"; desktop.AutoSize = true; desktop.Margin = new Padding(0, S(12), 0, 0);
            open.Text = "Hap SEO Tool pas instalimit"; open.AutoSize = true; open.Checked = true; open.Margin = new Padding(0, S(4), 0, S(6));
            row(desktop, 2);
            row(open, 2);
            Label note = text("Raportet, pamjet dhe të dhënat e Search Console ruhen te %LOCALAPPDATA%\\SEO Tool: instalimi dhe përditësimi s'i prekin. Çinstalimi: Cilësimet > Aplikacionet > SEO Tool (të dhënat ruhen si parazgjedhje). Ky instalues s'është i nënshkruar dixhitalisht; Windows mund të shfaqë paralajmërim.");
            note.ForeColor = Color.FromArgb(70, 80, 86);
            row(note, 2);
            output.Multiline = true; output.ReadOnly = true; output.ScrollBars = ScrollBars.Vertical; output.Size = new Size(wide, S(130));
            output.Font = new Font("Consolas", 9f); output.AccessibleName = "Ecuria e instalimit"; output.Margin = new Padding(0, S(6), 0, S(8));
            row(output, 2);
            FlowLayoutPanel bar = new FlowLayoutPanel { FlowDirection = FlowDirection.RightToLeft, AutoSize = false, Size = new Size(wide, S(44)), Margin = new Padding(0), WrapContents = false };
            close.Text = "Anulo"; close.AutoSize = true; close.Padding = new Padding(S(12), S(3), S(12), S(3));
            install.Text = "Instalo"; install.AutoSize = true; install.Padding = new Padding(S(12), S(3), S(12), S(3));
            status.AutoSize = true; status.MaximumSize = new Size(S(380), 0); status.Margin = new Padding(0, S(6), S(12), 0);
            bar.Controls.Add(close); bar.Controls.Add(install); bar.Controls.Add(status);
            row(bar, 2);
            install.Click += delegate { DoInstall(); };
            close.AccessibleDescription = "Para instalimit mbyll dritaren pa ndryshuar asgjë; gjatë nxjerrjes ndal instalimin dhe programi ekzistues mbetet siç ishte.";
            close.Click += delegate { if (installing) RequestCancel(); else Close(); };
            // Pa AcceptButton: Enter (p.sh. kur dritarja merr fokusin ndërsa përdoruesi shkruan) s'nis instalimin.
            CancelButton = close;
            // Gjatë instalimit dritarja s'mbyllet: Anulo/X kërkon ndalimin (vetëm para ndërrimit të programit).
            FormClosing += delegate(object _, FormClosingEventArgs a) { if (installing) { a.Cancel = true; RequestCancel(); } };
            Controls.Add(t);
        }

        void Browse()
        {
            using (FolderBrowserDialog d = new FolderBrowserDialog())
            {
                d.Description = "Zgjidh dosjen ku do të instalohet SEO Tool (krijohet nën-dosja \"SEO Tool\").";
                d.ShowNewFolderButton = true;
                if (d.ShowDialog(this) != DialogResult.OK) return;
                string p = d.SelectedPath;
                dirBox.Text = string.Equals(Path.GetFileName(p.TrimEnd('\\')), Installer.AppName, StringComparison.OrdinalIgnoreCase) ? p : Path.Combine(p, Installer.AppName);
            }
        }

        /// Instalim në një dosje tjetër nga ai i regjistruar: Yes = hiq programin e vjetër, No = mbaje, Cancel = mos instalo.
        /// Dialog i vetin (jo MessageBox), që butonat të jenë në shqip si teksti, pavarësisht gjuhës së Windows-it.
        DialogResult AskPrevious(string prev)
        {
            float scale;
            using (Graphics g = CreateGraphics()) scale = g.DpiX / 96f;
            Func<int, int> S = delegate(int v) { return (int)Math.Round(v * scale); };
            using (Form d = new Form())
            {
                d.Text = Text; d.Font = Font; d.AutoScaleMode = AutoScaleMode.None; d.FormBorderStyle = FormBorderStyle.FixedDialog;
                d.MinimizeBox = false; d.MaximizeBox = false; d.ShowInTaskbar = false; d.StartPosition = FormStartPosition.CenterParent;
                d.AutoSize = true; d.AutoSizeMode = AutoSizeMode.GrowAndShrink;
                TableLayoutPanel t = new TableLayoutPanel { ColumnCount = 1, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, Padding = new Padding(S(18)) };
                Label l = new Label { AutoSize = true, MaximumSize = new Size(S(520), 0), Margin = new Padding(0, 0, 0, S(14)),
                    Text = "Një version i SEO Tool është i instaluar te:\n" + prev + "\n\nÇfarë të bëhet me të pas instalimit në dosjen e re?\nRaportet dhe të dhënat te %LOCALAPPDATA%\\SEO Tool s'preken në asnjë rast." };
                t.Controls.Add(l);
                FlowLayoutPanel bar = new FlowLayoutPanel { FlowDirection = FlowDirection.RightToLeft, AutoSize = true, Dock = DockStyle.Fill, Margin = new Padding(0), WrapContents = false };
                Button cancel = new Button { Text = "Anulo", DialogResult = DialogResult.Cancel, AutoSize = true, Padding = new Padding(S(10), S(3), S(10), S(3)) };
                Button keep = new Button { Text = "Mbaje programin e vjetër", DialogResult = DialogResult.No, AutoSize = true, Padding = new Padding(S(10), S(3), S(10), S(3)) };
                Button remove = new Button { Text = "Hiq programin e vjetër", DialogResult = DialogResult.Yes, AutoSize = true, Padding = new Padding(S(10), S(3), S(10), S(3)) };
                keep.AccessibleDescription = "Programi i vjetër mbetet në dosjen e tij; Start Menu dhe çinstalimi do të tregojnë instalimin e ri.";
                remove.AccessibleDescription = "Pas instalimit hiqen vetëm skedarët e programit të vjetër; skedarët e tu mbeten.";
                bar.Controls.Add(cancel); bar.Controls.Add(keep); bar.Controls.Add(remove);
                t.Controls.Add(bar);
                d.Controls.Add(t);
                d.CancelButton = cancel;
                d.Shown += delegate { cancel.Focus(); };
                return d.ShowDialog(this);
            }
        }

        void RequestCancel()
        {
            if (!installing || committed || cancelRequested) return;
            cancelRequested = true;
            close.Enabled = false;
            status.Text = "Po anulohet…";
        }

        void Log(string line)
        {
            if (InvokeRequired) { BeginInvoke(new Action<string>(Log), line); return; }
            output.AppendText(line + Environment.NewLine);
        }

        void DoInstall()
        {
            string dir = dirBox.Text.Trim();
            string problem = Installer.DirProblem(dir);
            if (problem != null) { MessageBox.Show(this, problem, Text, MessageBoxButtons.OK, MessageBoxIcon.Warning); return; }
            bool keepPrevious = false;
            string prev = Installer.PreviousInstallDir();
            if (prev != null && !Installer.SameDir(prev, dir) && File.Exists(Path.Combine(prev, @"runtime\node.exe")))
            {
                DialogResult r = AskPrevious(prev);
                if (r == DialogResult.Cancel) return;
                keepPrevious = r == DialogResult.No;
            }
            Options o = new Options { Dir = dir, Desktop = desktop.Checked, Open = open.Checked, KeepPrevious = keepPrevious };
            foreach (Control c in new Control[] { dirBox, browse, desktop, open, install }) c.Enabled = false;
            status.Text = "Po instalohet…";
            cancelRequested = false;
            committed = false;
            installing = true;
            Thread t = new Thread(delegate()
            {
                int code;
                try
                {
                    code = Installer.Run(o, Log,
                        delegate(int n, int total) { BeginInvoke(new Action(delegate { if (!cancelRequested) status.Text = "Po nxirren skedarët: " + n + "/" + total; })); },
                        delegate { return cancelRequested; },
                        // Nga ky çast programi zëvendësohet: anulimi s'pranohet më (do të linte gjysmë ndërrimi).
                        delegate { committed = true; BeginInvoke(new Action(delegate { close.Enabled = false; status.Text = "Po zëvendësohet programi…"; })); });
                }
                catch (Exception e) { Log("Gabim: " + e.Message); code = 1; }
                BeginInvoke(new Action(delegate { Done(code); }));
            });
            t.IsBackground = true;
            t.Start();
        }

        void Done(int code)
        {
            installing = false;
            close.Text = "Mbyll";
            close.Enabled = true;
            close.Focus();
            if (code == 0) { status.Text = "SEO Tool u instalua. Hape nga Start Menu: SEO Tool."; status.ForeColor = Color.FromArgb(29, 116, 72); return; }
            status.ForeColor = Color.FromArgb(179, 38, 30);
            if (code == 11) { status.ForeColor = SystemColors.ControlText; status.Text = "U anulua. Programi ekzistues mbeti siç ishte."; }
            else status.Text = code == 3 ? "SEO Tool është i hapur: mbylle dhe provo përsëri." : "Instalimi s'përfundoi (kodi " + code + "); shih mesazhet më lart.";
            foreach (Control c in new Control[] { dirBox, browse, desktop, open, install }) c.Enabled = true;
        }
    }

    internal static class Program
    {
        static Options Parse(string[] args)
        {
            Options o = new Options();
            foreach (string a in args)
            {
                string u = a.ToUpperInvariant();
                if (u == "/S" || u == "/SILENT" || u == "--SILENT") o.Silent = true;
                else if (u.StartsWith("/DIR=")) o.Dir = a.Substring(5).Trim('"');
                else if (u.StartsWith("/D=")) o.Dir = a.Substring(3).Trim('"');
                else if (u == "/DESKTOP") o.Desktop = true;
                else if (u == "/OPEN") o.Open = true;
                else if (u == "/KEEPPREVIOUS") o.KeepPrevious = true;
                else if (u.StartsWith("/LOG=")) o.LogFile = a.Substring(5).Trim('"');
                // P.sh. një shteg me hapësira pa thonjëza ("/DIR=C:\Seo app\SEO Tool" → 3 argumente):
                // s'injorohet, që të mos instalohet në një dosje tjetër nga ajo që u kërkua.
                else o.Unknown.Add(a);
            }
            if (string.IsNullOrEmpty(o.Dir)) o.Dir = Installer.DefaultDir();
            return o;
        }

        [STAThread]
        static int Main(string[] args)
        {
            Options o = Parse(args);
            if (o.Silent)
            {
                StringBuilder sb = new StringBuilder();
                Action<string> log = delegate(string l) { sb.AppendLine(l); try { Console.WriteLine(l); } catch { } };
                int code;
                if (o.Unknown.Count > 0)
                {
                    log("Argumente të panjohura: " + string.Join(" ", o.Unknown.ToArray()) + ". Shteg me hapësira: /DIR=\"C:\\Dosja ime\\SEO Tool\" (me thonjëza).");
                    code = 2;
                }
                else
                try { code = Installer.Run(o, log, null, null, null); }
                catch (Exception e) { log("Gabim: " + e.Message); code = 1; }
                log("Kodi: " + code);
                if (!string.IsNullOrEmpty(o.LogFile)) { try { File.WriteAllText(o.LogFile, sb.ToString(), new UTF8Encoding(false)); } catch { } }
                return code;
            }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new SetupForm());
            return 0;
        }
    }
}
