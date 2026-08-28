using System.Diagnostics;
using System.IO;
using System.Text.Json;
using VRCNT.RuntimeCore.Manager;
using VRCNT.RuntimeCore.Models;
using VRCNT.RuntimeCore.Paths;
using VRCNT.RuntimeCore.Transactions;
using VRCNT.Setup.CommandLine;

namespace VRCNT.Setup;

public sealed class SetupCommandOperations : ISetupCommandOperations
{
    private const string ReleaseEndpoint = "https://github.com/awakenginexe/VRCNT/releases/";
    private const string RuntimeReleaseEndpoint = "https://github.com/awakenginexe/VRCNT/releases/latest/download/";
    private readonly IRuntimeTransactionEngine _runtimeEngine;
    private readonly IManagerLifecycle _managerLifecycle;
    private readonly Uri _managerLatestJsonUri;
    private readonly string _managerDirectory;
    private readonly string _managerPath;
    private readonly Func<string, UserDataPaths> _resolveUserDataPaths;

    public SetupCommandOperations(
        IRuntimeTransactionEngine runtimeEngine,
        IManagerLifecycle managerLifecycle,
        Uri managerLatestJsonUri,
        string? managerDirectory = null,
        string? managerPath = null,
        Func<string, UserDataPaths>? resolveUserDataPaths = null)
    {
        _runtimeEngine = runtimeEngine ?? throw new ArgumentNullException(nameof(runtimeEngine));
        _managerLifecycle = managerLifecycle ?? throw new ArgumentNullException(nameof(managerLifecycle));
        _managerLatestJsonUri = managerLatestJsonUri ?? throw new ArgumentNullException(nameof(managerLatestJsonUri));
        _managerDirectory = Path.GetFullPath(managerDirectory ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "VRCNTInstaller"));
        _managerPath = Path.GetFullPath(managerPath ?? Path.Combine(_managerDirectory, "VRCNT.Setup.exe"));
        _resolveUserDataPaths = resolveUserDataPaths ?? new UserDataPathResolver().Resolve;
    }

    public static SetupCommandOperations CreateProduction(ManagerCapabilities capabilities)
    {
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var managerDirectory = Path.Combine(localAppData, "VRCNTInstaller");
        var managerPath = Path.Combine(managerDirectory, "VRCNT.Setup.exe");
        var cacheDirectory = Path.Combine(managerDirectory, "runtime-cache");
        var tools = SetupToolLayout.Require(AppContext.BaseDirectory);
        var minisignPath = tools.MinisignPath;
        var sevenZipPath = tools.SevenZipPath;
        var manifestLoader = new VRCNT.RuntimeCore.Manifest.ManifestLoader(new VRCNT.RuntimeCore.Security.MinisignVerifier(minisignPath));
        var signatureVerifier = new MinisignSetupSignatureVerifier(minisignPath);
        var source = new HttpManagerRepairSource(capabilities, manifestLoader, signatureVerifier, new Uri(ReleaseEndpoint), managerDirectory);
        var selfCheck = new ManagerSelfCheck(capabilities, signatureVerifier);
        var handoff = new ManagerHandoff(
            managerPath,
            selfCheck.CheckEmbeddedAsync,
            selfCheck.CheckEmbeddedAsync,
            new ProcessManagerExitCoordinator(managerPath).ExitAndWaitAsync);
        return new SetupCommandOperations(
            new RuntimeInstallEngine(managerDirectory, cacheDirectory, minisignPath, sevenZipPath),
            new SetupManagerLifecycle(managerPath, null, selfCheck, new ManagerStateStore(localAppData, capabilities, managerPath), source, handoff),
            new Uri(ReleaseEndpoint + "latest/download/latest.json"),
            managerDirectory,
            managerPath);
    }

    public async Task ExecuteRuntimeAsync(SetupCommandLineOptions options, IProgress<InstallProgress>? progress, CancellationToken cancellationToken)
    {
        var installPath = options.InstallPath ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "VRCNT");
        var paths = _resolveUserDataPaths(installPath);
        var configPath = Path.Combine(paths.DataRoot, "config.json");
        var initializeLanguage = ShouldInitializeLanguage(options);
        var result = await _runtimeEngine.ExecuteAsync(new RuntimeInstallRequest(
            options.Variant ?? RuntimeVariant.Cpu,
            ManagerCapabilities.Current.Version,
            installPath,
            RuntimeReleaseEndpoint,
            string.Empty,
            false),
            progress,
            cancellationToken);
        if (!result.Succeeded) throw new InvalidOperationException(result.ErrorMessage ?? result.ErrorCode ?? "Runtime installation failed.");
        if (initializeLanguage && !File.Exists(configPath)) WriteInitialLanguageIfAbsent(configPath, options.InstallerLanguage!);
    }

    public async Task ExecuteRepairManagerAsync(SetupCommandLineOptions options, CancellationToken cancellationToken)
    {
        if (!options.IsManagerRepairWorker)
        {
            await LaunchRepairWorkerAsync(options, cancellationToken);
            return;
        }

        var result = await _managerLifecycle.RepairAsync(_managerLatestJsonUri, cancellationToken);
        if (!result.Succeeded) throw new InvalidOperationException(result.FailureCode ?? "Manager repair failed closed.");
    }

    private async Task LaunchRepairWorkerAsync(SetupCommandLineOptions options, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var currentPath = Process.GetCurrentProcess().MainModule?.FileName;
        if (string.IsNullOrWhiteSpace(currentPath)) throw new InvalidOperationException("The setup manager executable path is unavailable.");

        var workerDirectory = Path.Combine(_managerDirectory, "repair", $"worker-{Guid.NewGuid():N}");
        Directory.CreateDirectory(workerDirectory);
        var workerPath = Path.Combine(workerDirectory, "VRCNT.Setup.exe");
        File.Copy(currentPath, workerPath);
        var tools = SetupToolLayout.Require(AppContext.BaseDirectory);
        SetupToolLayout.CopyToWorker(tools, workerDirectory);
        SetupToolLayout.CopyToWorker(tools, _managerDirectory);

        var start = new ProcessStartInfo(workerPath)
        {
            UseShellExecute = false,
            WorkingDirectory = _managerDirectory,
        };
        start.ArgumentList.Add("--repair-manager");
        start.ArgumentList.Add("--manager-repair-worker");
        if (options.IsPassive) start.ArgumentList.Add("/passive");
        if (options.CurrentAppPath is not null)
        {
            start.ArgumentList.Add("--current-app");
            start.ArgumentList.Add(options.CurrentAppPath);
            foreach (var argument in options.CurrentAppArguments)
            {
                start.ArgumentList.Add("--current-app-arg");
                start.ArgumentList.Add(argument);
            }
        }

        _ = Process.Start(start) ?? throw new InvalidOperationException("Unable to start the out-of-process manager repair worker.");
        await Task.CompletedTask;
    }

    public Task HandoffToCurrentAppAsync(SetupCommandLineOptions options, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (options.CurrentAppPath is null) return Task.CompletedTask;
        if (!File.Exists(options.CurrentAppPath)) throw new FileNotFoundException("The current VRCNT application was not found.", options.CurrentAppPath);
        var start = new ProcessStartInfo(options.CurrentAppPath) { UseShellExecute = false, WorkingDirectory = Path.GetDirectoryName(options.CurrentAppPath)! };
        foreach (var argument in options.CurrentAppArguments) start.ArgumentList.Add(argument);
        _ = Process.Start(start) ?? throw new InvalidOperationException("Unable to hand off to the current VRCNT application.");
        return Task.CompletedTask;
    }

    private static bool ShouldInitializeLanguage(SetupCommandLineOptions options) =>
        !options.IsUpdate && !options.IsSwitch && !string.IsNullOrWhiteSpace(options.InstallerLanguage);

    private static void WriteInitialLanguageIfAbsent(string configPath, string languageId)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(configPath)!);
        try
        {
            using var stream = new FileStream(configPath, FileMode.CreateNew, FileAccess.Write, FileShare.None);
            JsonSerializer.Serialize(stream, new Dictionary<string, string>
            {
                ["UI_LANGUAGE"] = languageId,
            });
        }
        catch (IOException) when (File.Exists(configPath))
        {
            // The runtime transaction may have migrated existing user settings during preflight.
        }
    }
}
