using System.Diagnostics;

namespace VRCNT.RuntimeCore.Archive;

public interface IArchiveExtractor
{
    Task<IReadOnlyList<string>> ListEntriesAsync(IReadOnlyList<string> archiveParts, CancellationToken cancellationToken);
    Task TestAsync(IReadOnlyList<string> archiveParts, CancellationToken cancellationToken);
    Task ExtractAsync(IReadOnlyList<string> archiveParts, string destination, CancellationToken cancellationToken);
}

public sealed class SevenZipExtractor(string executablePath) : IArchiveExtractor
{
    public async Task<IReadOnlyList<string>> ListEntriesAsync(IReadOnlyList<string> archiveParts, CancellationToken cancellationToken)
    {
        var output = await RunAsync(["l", "-slt", FirstPart(archiveParts)], cancellationToken);
        var archive = Path.GetFullPath(FirstPart(archiveParts));
        return output.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries)
            .Where(line => line.StartsWith("Path = ", StringComparison.Ordinal))
            .Select(line => line[7..].Trim())
            .Where(path => !string.Equals(Path.GetFullPath(path), archive, StringComparison.OrdinalIgnoreCase))
            .ToArray();
    }

    public async Task TestAsync(IReadOnlyList<string> archiveParts, CancellationToken cancellationToken) =>
        _ = await RunAsync(["t", "-y", FirstPart(archiveParts)], cancellationToken);

    public async Task ExtractAsync(IReadOnlyList<string> archiveParts, string destination, CancellationToken cancellationToken)
    {
        if (!Path.IsPathFullyQualified(destination)) throw new InvalidDataException("Archive extraction requires an absolute staging directory.");
        Directory.CreateDirectory(destination);
        _ = await RunAsync(["x", "-y", $"-o{destination}", FirstPart(archiveParts)], cancellationToken);
    }

    private async Task<string> RunAsync(IReadOnlyList<string> arguments, CancellationToken cancellationToken)
    {
        if (!File.Exists(executablePath)) throw new FileNotFoundException("The bundled 7z executable is missing.", executablePath);
        var start = new ProcessStartInfo(executablePath) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
        foreach (var argument in arguments) start.ArgumentList.Add(argument);
        using var process = System.Diagnostics.Process.Start(start) ?? throw new InvalidOperationException("Unable to start 7z.");
        var output = await process.StandardOutput.ReadToEndAsync(cancellationToken);
        var error = await process.StandardError.ReadToEndAsync(cancellationToken);
        await process.WaitForExitAsync(cancellationToken);
        if (process.ExitCode != 0) throw new InvalidDataException($"7z rejected the archive: {error.Trim()}");
        return output;
    }

    private static string FirstPart(IReadOnlyList<string> archiveParts) => archiveParts.Count > 0 && archiveParts.All(File.Exists)
        ? archiveParts[0]
        : throw new FileNotFoundException("A required runtime archive part is missing.");
}
