using System.IO;
using VRCNT.RuntimeCore.Models;

namespace VRCNT.Setup.CommandLine;

public sealed record SetupCommandLineOptions(
    bool IsUpdate,
    bool IsPassive,
    bool IsSwitch,
    bool IsRepairManager,
    RuntimeVariant? Variant,
    string? InstallPath,
    string? CurrentAppPath,
    IReadOnlyList<string> CurrentAppArguments);

public static class SetupCommandLine
{
    public static SetupCommandLineOptions Parse(IReadOnlyList<string> args)
    {
        var isUpdate = false;
        var isPassive = false;
        var isSwitch = false;
        var isRepairManager = false;
        RuntimeVariant? variant = null;
        string? installPath = null;
        string? currentAppPath = null;
        var currentAppArguments = new List<string>();

        for (var index = 0; index < args.Count; index++)
        {
            var argument = args[index];
            if (argument.Equals("/UPDATE", StringComparison.OrdinalIgnoreCase)) { isUpdate = true; continue; }
            if (argument.Equals("/passive", StringComparison.OrdinalIgnoreCase)) { isPassive = true; continue; }
            if (argument.Equals("--switch", StringComparison.OrdinalIgnoreCase)) { isSwitch = true; continue; }
            if (argument.Equals("--repair-manager", StringComparison.OrdinalIgnoreCase)) { isRepairManager = true; continue; }
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
            throw new ArgumentException($"Unknown setup manager argument '{argument}'.", nameof(args));
        }

        if (isSwitch && variant is null) throw new ArgumentException("--switch requires --variant cpu|cuda.", nameof(args));
        if (variant is not null && !isSwitch) throw new ArgumentException("--variant is only valid with --switch.", nameof(args));
        return new SetupCommandLineOptions(isUpdate, isPassive, isSwitch, isRepairManager, variant, installPath, currentAppPath, currentAppArguments);
    }

    private static string NextValue(IReadOnlyList<string> args, ref int index, string option)
    {
        if (++index >= args.Count || string.IsNullOrWhiteSpace(args[index])) throw new ArgumentException($"{option} requires a value.", nameof(args));
        return args[index];
    }
}
