using VRCNT.RuntimeCore.Paths;
using VRCNT.RuntimeCore.Models;

namespace VRCNT.RuntimeCore.Migration;

public sealed record LegacyInstallation(
    UserDataPaths Paths,
    bool HasRuntimeMarker,
    bool RequiresMigration,
    IReadOnlyList<string> PreservationSources,
    RuntimeVariant? DetectedVariant = null);

public sealed class LegacyInstallationDetector(UserDataPathResolver pathResolver)
{
    public LegacyInstallation Detect(string localAppData, string installPath)
    {
        return Detect(pathResolver.Resolve(localAppData, installPath));
    }

    public LegacyInstallation Detect(UserDataPaths paths)
    {
        var hasRuntimeMarker = File.Exists(Path.Combine(paths.InstallPath, "VRCNT.runtime.json"));
        var sources = new[] { paths.LegacyDataRoot, paths.InstallPath }
            .Where(HasPreservableUserData)
            .ToArray();
        var hasLegacyPayload = File.Exists(Path.Combine(paths.InstallPath, "VRCNT.exe"));
        return new LegacyInstallation(
            paths,
            hasRuntimeMarker,
            !hasRuntimeMarker && (hasLegacyPayload || sources.Length > 0),
            sources,
            hasLegacyPayload ? DetectPayloadVariant(paths.InstallPath) : null);
    }

    public void PreserveUserData(LegacyInstallation legacyInstallation)
    {
        Directory.CreateDirectory(legacyInstallation.Paths.DataRoot);
        foreach (var source in legacyInstallation.PreservationSources)
        {
            if (PathsEqual(source, legacyInstallation.Paths.DataRoot)) continue;
            CopyFileWithoutOverwrite(Path.Combine(source, "config.json"), Path.Combine(legacyInstallation.Paths.DataRoot, "config.json"));
            foreach (var directoryName in new[] { "weights", "logs" })
                CopyDirectoryWithoutOverwrite(Path.Combine(source, directoryName), Path.Combine(legacyInstallation.Paths.DataRoot, directoryName));
        }
    }

    private static bool HasPreservableUserData(string path) =>
        File.Exists(Path.Combine(path, "config.json")) || Directory.Exists(Path.Combine(path, "weights")) || Directory.Exists(Path.Combine(path, "logs"));

    private static RuntimeVariant? DetectPayloadVariant(string installPath)
    {
        try
        {
            var dllNames = Directory.EnumerateFiles(installPath, "*", SearchOption.AllDirectories)
                .Where(path => string.Equals(Path.GetExtension(path), ".dll", StringComparison.OrdinalIgnoreCase))
                .Select(path => Path.GetFileName(path))
                .ToArray();
            var hasCudaBoundary = dllNames.Any(name => name.StartsWith("torch_cuda", StringComparison.OrdinalIgnoreCase) ||
                    name.StartsWith("c10_cuda", StringComparison.OrdinalIgnoreCase) ||
                    name.StartsWith("cudnn", StringComparison.OrdinalIgnoreCase) ||
                    name.StartsWith("cublas", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(name, "onnxruntime_providers_cuda.dll", StringComparison.OrdinalIgnoreCase) ||
                    name.Contains("sherpa-onnx-cuda", StringComparison.OrdinalIgnoreCase));
            if (hasCudaBoundary) return RuntimeVariant.Cuda;

            var hasCpuBoundary = dllNames.Any(name => string.Equals(name, "torch_cpu.dll", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(name, "onnxruntime.dll", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(name, "sherpa-onnx.dll", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(name, "sherpa_onnx.dll", StringComparison.OrdinalIgnoreCase));
            return hasCpuBoundary ? RuntimeVariant.Cpu : null;
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    private static void CopyDirectoryWithoutOverwrite(string source, string destination)
    {
        if (!Directory.Exists(source)) return;
        foreach (var sourceFile in Directory.EnumerateFiles(source, "*", SearchOption.AllDirectories))
        {
            var relativePath = Path.GetRelativePath(source, sourceFile);
            CopyFileWithoutOverwrite(sourceFile, Path.Combine(destination, relativePath));
        }
    }

    private static void CopyFileWithoutOverwrite(string source, string destination)
    {
        if (!File.Exists(source) || File.Exists(destination)) return;
        Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
        File.Copy(source, destination);
    }

    private static bool PathsEqual(string left, string right) => string.Equals(Path.GetFullPath(left), Path.GetFullPath(right), StringComparison.OrdinalIgnoreCase);
}
