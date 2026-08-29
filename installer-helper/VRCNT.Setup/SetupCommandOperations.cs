using System.Diagnostics;
using System.IO;
using System.Text.Json;
using VRCNT.RuntimeCore.Manager;
using VRCNT.RuntimeCore.Migration;
using VRCNT.RuntimeCore.Models;
using VRCNT.RuntimeCore.Paths;
using VRCNT.RuntimeCore.State;
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
    private readonly IActiveRuntimeLocator _activeRuntimeLocator;

    public SetupCommandOperations(
        IRuntimeTransactionEngine runtimeEngine,
        IManagerLifecycle managerLifecycle,
        Uri managerLatestJsonUri,
        string? managerDirectory = null,
        string? managerPath = null,
        Func<string, UserDataPaths>? resolveUserDataPaths = null,
        IActiveRuntimeLocator? activeRuntimeLocator = null)
    {
        _runtimeEngine = runtimeEngine ?? throw new ArgumentNullException(nameof(runtimeEngine));
        _managerLifecycle = managerLifecycle ?? throw new ArgumentNullException(nameof(managerLifecycle));
        _managerLatestJsonUri = managerLatestJsonUri ?? throw new ArgumentNullException(nameof(managerLatestJsonUri));
        _managerDirectory = Path.GetFullPath(managerDirectory ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "VRCNTInstaller"));
        _managerPath = Path.GetFullPath(managerPath ?? Path.Combine(_managerDirectory, "VRCNT.Setup.exe"));
        _resolveUserDataPaths = resolveUserDataPaths ?? new UserDataPathResolver().Resolve;
        _activeRuntimeLocator = activeRuntimeLocator ?? new ActiveRuntimeLocator();
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
        var activeRuntime = IsImplicitUpdater(options) ? ResolveImplicitUpdateRuntime() : null;
        var installPath = activeRuntime?.InstallPath ?? options.InstallPath ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "VRCNT");
        var paths = _resolveUserDataPaths(installPath);
        var configPath = Path.Combine(paths.DataRoot, "config.json");
        var initializeLanguage = ShouldInitializeLanguage(options);
        var targetVariant = options.IsSwitch
            ? options.TargetVariant ?? throw new InvalidDataException("A runtime switch requires an explicit target variant.")
            : activeRuntime?.Variant ?? options.TargetVariant ?? RuntimeVariant.Cpu;
        RuntimeSwitchStatusStore? statusStore = null;
        RuntimeShutdownHandoff? shutdownHandoff = null;
        if (options.IsSwitch)
        {
            if (options.SwitchToken is null || options.SwitchStatusPath is null || options.CurrentAppPath is null)
                throw new InvalidDataException("The runtime switch handoff is incomplete.");
            statusStore = new RuntimeSwitchStatusStore(paths.DataRoot, options.SwitchStatusPath);
            shutdownHandoff = statusStore.ValidatePending(
                targetVariant == RuntimeVariant.Cuda ? "cuda" : "cpu",
                installPath,
                options.CurrentAppPath,
                options.SwitchToken);
            statusStore.WriteAccepted(targetVariant == RuntimeVariant.Cuda ? "cuda" : "cpu", shutdownHandoff);
        }

        var terminalStatusWritten = false;
        var retryableOutcomeCleared = false;
        try
        {
            if (statusStore is not null) statusStore.WriteRunning(targetVariant == RuntimeVariant.Cuda ? "cuda" : "cpu", shutdownHandoff!);
            var result = await _runtimeEngine.ExecuteAsync(new RuntimeInstallRequest(
                targetVariant,
                ManagerCapabilities.Current.Version,
                installPath,
                RuntimeReleaseEndpoint,
                string.Empty,
                false,
                shutdownHandoff),
                progress,
                cancellationToken);
            if (!result.Succeeded)
            {
                if (statusStore is not null && shutdownHandoff is not null && !statusStore.IsShutdownAcknowledged(shutdownHandoff))
                {
                    statusStore.ClearForRetry(shutdownHandoff);
                    retryableOutcomeCleared = true;
                }
                else if (statusStore is not null)
                {
                    statusStore.WriteTerminal("failed", targetVariant == RuntimeVariant.Cuda ? "cuda" : "cpu", shutdownHandoff!, result.ErrorCode, result.ErrorMessage);
                    terminalStatusWritten = true;
                }
                throw new InvalidOperationException(result.ErrorMessage ?? result.ErrorCode ?? "Runtime installation failed.");
            }
            statusStore?.WriteTerminal("succeeded", targetVariant == RuntimeVariant.Cuda ? "cuda" : "cpu", shutdownHandoff!, null, null);
            terminalStatusWritten = statusStore is not null;
            if (initializeLanguage && !File.Exists(configPath)) WriteInitialLanguageIfAbsent(configPath, options.InstallerLanguage!);
        }
        catch (OperationCanceledException)
        {
            if (statusStore is not null && shutdownHandoff is not null && !statusStore.IsShutdownAcknowledged(shutdownHandoff))
                statusStore.ClearForRetry(shutdownHandoff);
            else if (statusStore is not null)
                statusStore.WriteTerminal("cancelled", targetVariant == RuntimeVariant.Cuda ? "cuda" : "cpu", shutdownHandoff!, "cancelled", "Runtime switch cancelled.");
            throw;
        }
        catch (Exception exception)
        {
            if (!terminalStatusWritten && !retryableOutcomeCleared && statusStore is not null && shutdownHandoff is not null)
            {
                if (!statusStore.IsShutdownAcknowledged(shutdownHandoff)) statusStore.ClearForRetry(shutdownHandoff);
                else statusStore.WriteTerminal("failed", targetVariant == RuntimeVariant.Cuda ? "cuda" : "cpu", shutdownHandoff, "transaction_failed", exception.Message);
            }
            throw;
        }
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
        if (options.IsUpdate) await LaunchPromotedManagerAsync(options, cancellationToken);
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
        if (options.IsUpdate) start.ArgumentList.Add("/UPDATE");
        start.ArgumentList.Add("--repair-manager");
        start.ArgumentList.Add("--manager-repair-worker");
        if (options.IsPassive) start.ArgumentList.Add("/passive");
        if (options.CurrentAppPath is not null)
        {
            start.ArgumentList.Add("--current-app");
            start.ArgumentList.Add(options.CurrentAppPath);
        }
        foreach (var argument in options.CurrentAppArguments)
        {
            start.ArgumentList.Add("--current-app-arg");
            start.ArgumentList.Add(argument);
        }

        var worker = Process.Start(start) ?? throw new InvalidOperationException("Unable to start the out-of-process manager repair worker.");
        await worker.WaitForExitAsync(cancellationToken);
        if (worker.ExitCode != 0) throw new InvalidOperationException($"The out-of-process manager repair worker failed with exit code {worker.ExitCode}.");
    }

    private async Task LaunchPromotedManagerAsync(SetupCommandLineOptions options, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (!File.Exists(_managerPath)) throw new FileNotFoundException("The promoted stable setup manager was not found.", _managerPath);
        var start = new ProcessStartInfo(_managerPath)
        {
            UseShellExecute = false,
            WorkingDirectory = _managerDirectory,
        };
        start.ArgumentList.Add("/UPDATE");
        start.ArgumentList.Add("--manager-repaired");
        if (options.IsPassive) start.ArgumentList.Add("/passive");
        if (options.CurrentAppPath is not null)
        {
            start.ArgumentList.Add("--current-app");
            start.ArgumentList.Add(options.CurrentAppPath);
        }
        foreach (var argument in options.CurrentAppArguments)
        {
            start.ArgumentList.Add("--current-app-arg");
            start.ArgumentList.Add(argument);
        }
        var manager = Process.Start(start) ?? throw new InvalidOperationException("Unable to start the promoted stable setup manager.");
        await manager.WaitForExitAsync(cancellationToken);
        if (manager.ExitCode != 0) throw new InvalidOperationException($"The promoted stable setup manager failed with exit code {manager.ExitCode}.");
    }

    public Task HandoffToCurrentAppAsync(SetupCommandLineOptions options, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var currentAppPath = options.CurrentAppPath ?? (options.IsUpdate ? _activeRuntimeLocator.Resolve().CurrentAppPath : null);
        if (currentAppPath is null) return Task.CompletedTask;
        if (!File.Exists(currentAppPath)) throw new FileNotFoundException("The current VRCNT application was not found.", currentAppPath);
        var start = new ProcessStartInfo(currentAppPath) { UseShellExecute = false, WorkingDirectory = Path.GetDirectoryName(currentAppPath)! };
        foreach (var argument in options.CurrentAppArguments) start.ArgumentList.Add(argument);
        _ = Process.Start(start) ?? throw new InvalidOperationException("Unable to hand off to the current VRCNT application.");
        return Task.CompletedTask;
    }

    private static bool ShouldInitializeLanguage(SetupCommandLineOptions options) =>
        !options.IsUpdate && !options.IsSwitch && !string.IsNullOrWhiteSpace(options.InstallerLanguage);

    private static bool IsImplicitUpdater(SetupCommandLineOptions options) =>
        options.IsUpdate && !options.IsSwitch && options.TargetVariant is null;

    private ActiveRuntime ResolveImplicitUpdateRuntime()
    {
        try
        {
            return _activeRuntimeLocator.Resolve();
        }
        catch (InvalidDataException stateException)
        {
            var paths = new UserDataPathResolver();
            var defaultInstallPath = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "VRCNT");
            var resolvedLegacyPaths = _resolveUserDataPaths(defaultInstallPath);
            var canonicalInstallPath = paths.ValidateCustomInstallPath(resolvedLegacyPaths.InstallPath);
            var legacy = new LegacyInstallationDetector(paths).Detect(
                resolvedLegacyPaths with { InstallPath = canonicalInstallPath });
            if (legacy.RequiresMigration && legacy.DetectedVariant is { } variant &&
                File.Exists(Path.Combine(canonicalInstallPath, "VRCNT.exe")))
            {
                return new ActiveRuntime(variant, canonicalInstallPath, Path.Combine(canonicalInstallPath, "VRCNT.exe"));
            }

            throw new InvalidDataException(
                "The installed runtime state is unavailable; explicit migration/runtime selection is required.",
                stateException);
        }
    }

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
