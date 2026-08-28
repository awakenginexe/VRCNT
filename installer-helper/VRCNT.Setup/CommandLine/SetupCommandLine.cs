using System.IO;
using VRCNT.RuntimeCore.Models;

namespace VRCNT.Setup.CommandLine;

public sealed record SetupCommandLineOptions(
    bool IsUpdate,
    bool IsPassive,
    bool IsSwitch,
    bool IsRepairManager,
    bool IsManagerRepairWorker,
    RuntimeVariant? TargetVariant,
    string? InstallPath,
    string? CurrentAppPath,
    IReadOnlyList<string> CurrentAppArguments,
    string? InstallerLanguage,
    string? SwitchToken = null,
    string? SwitchStatusPath = null)
{
    // Compatibility alias for callers that still use the generic install name.
    public RuntimeVariant? Variant => TargetVariant;
}

public static class SetupCommandLine
{
    private static readonly HashSet<string> SupportedInstallerLanguages = new(StringComparer.Ordinal)
    {
        "en", "ja", "ko", "th", "zh-Hant", "zh-Hans",
    };

    public static SetupCommandLineOptions Parse(IReadOnlyList<string> args)
    {
        var isUpdate = false;
        var isPassive = false;
        var isSwitch = false;
        var isRepairManager = false;
        var isManagerRepairWorker = false;
        RuntimeVariant? variant = null;
        string? installPath = null;
        string? currentAppPath = null;
        string? installerLanguage = null;
        string? switchToken = null;
        string? switchStatusPath = null;
        var currentAppArguments = new List<string>();

        for (var index = 0; index < args.Count; index++)
        {
            var argument = args[index];
            if (argument.Equals("/UPDATE", StringComparison.OrdinalIgnoreCase)) { isUpdate = true; continue; }
            if (argument.Equals("/passive", StringComparison.OrdinalIgnoreCase)) { isPassive = true; continue; }
            if (argument.Equals("--switch", StringComparison.OrdinalIgnoreCase)) { isSwitch = true; continue; }
            if (argument.Equals("--repair-manager", StringComparison.OrdinalIgnoreCase)) { isRepairManager = true; continue; }
            if (argument.Equals("--manager-repair-worker", StringComparison.OrdinalIgnoreCase)) { isManagerRepairWorker = true; continue; }
            if (argument.Equals("--variant", StringComparison.OrdinalIgnoreCase))
            {
                var rawVariant = NextValue(args, ref index, "--variant");
                variant = rawVariant.ToLowerInvariant() switch
                {
                    "cpu" => RuntimeVariant.Cpu,
                    "cuda" => RuntimeVariant.Cuda,
                    _ => throw new ArgumentException("--variant must be cpu or cuda.", nameof(args)),
                };
                continue;
            }
            if (argument.Equals("--install-path", StringComparison.OrdinalIgnoreCase))
            {
                installPath = Path.GetFullPath(NextValue(args, ref index, "--install-path"));
                continue;
            }
            if (argument.Equals("--current-app", StringComparison.OrdinalIgnoreCase))
            {
                currentAppPath = Path.GetFullPath(NextValue(args, ref index, "--current-app"));
                continue;
            }
            if (argument.Equals("--current-app-arg", StringComparison.OrdinalIgnoreCase))
            {
                currentAppArguments.Add(NextValue(args, ref index, "--current-app-arg"));
                continue;
            }
            if (argument.Equals("--switch-token", StringComparison.OrdinalIgnoreCase))
            {
                switchToken = NextValue(args, ref index, "--switch-token");
                continue;
            }
            if (argument.Equals("--switch-status", StringComparison.OrdinalIgnoreCase))
            {
                switchStatusPath = Path.GetFullPath(NextValue(args, ref index, "--switch-status"));
                continue;
            }
            if (argument.Equals("--installer-language", StringComparison.OrdinalIgnoreCase))
            {
                installerLanguage = NextValue(args, ref index, "--installer-language");
                if (!SupportedInstallerLanguages.Contains(installerLanguage))
                    throw new ArgumentException("--installer-language must be a supported VRCNT language.", nameof(args));
                continue;
            }
            throw new ArgumentException($"Unknown setup manager argument '{argument}'.", nameof(args));
        }

        if (isSwitch && variant is null) throw new ArgumentException("--switch requires --variant cpu|cuda.", nameof(args));
        if (variant is not null && !isSwitch) throw new ArgumentException("--variant is only valid with --switch.", nameof(args));
        if (!isSwitch && (switchToken is not null || switchStatusPath is not null)) throw new ArgumentException("Switch handoff arguments are only valid with --switch.", nameof(args));
        if (isManagerRepairWorker && !isRepairManager) throw new ArgumentException("--manager-repair-worker requires --repair-manager.", nameof(args));
        return new SetupCommandLineOptions(isUpdate, isPassive, isSwitch, isRepairManager, isManagerRepairWorker, variant, installPath, currentAppPath, currentAppArguments, installerLanguage, switchToken, switchStatusPath);
    }

    public static bool ShouldShowUi(SetupCommandLineOptions options) => !options.IsPassive;

    private static string NextValue(IReadOnlyList<string> args, ref int index, string option)
    {
        if (++index >= args.Count || string.IsNullOrWhiteSpace(args[index])) throw new ArgumentException($"{option} requires a value.", nameof(args));
        return args[index];
    }
}
