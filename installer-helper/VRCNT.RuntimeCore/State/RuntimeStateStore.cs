using System.Text.Json;
using VRCNT.RuntimeCore.Models;

namespace VRCNT.RuntimeCore.State;

public interface IRuntimeStateStore
{
    RuntimeState Read(string dataRoot);
    void WriteAtomic(string dataRoot, RuntimeState state);
}

public sealed class RuntimeStateStore : IRuntimeStateStore
{
    private const string StateFileName = "runtime.json";
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true, WriteIndented = true };

    public RuntimeState Read(string dataRoot)
    {
        try
        {
            var statePath = Path.Combine(dataRoot, StateFileName);
            if (!File.Exists(statePath)) return RecoveryState();
            var state = JsonSerializer.Deserialize<RuntimeState>(File.ReadAllText(statePath), JsonOptions);
            return state is null ? RecoveryState() : state;
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or JsonException)
        {
            return RecoveryState();
        }
    }

    public void WriteAtomic(string dataRoot, RuntimeState state)
    {
        Directory.CreateDirectory(dataRoot);
        var statePath = Path.Combine(dataRoot, StateFileName);
        var temporaryPath = Path.Combine(dataRoot, $"{StateFileName}.{Guid.NewGuid():N}.tmp");
        try
        {
            File.WriteAllText(temporaryPath, JsonSerializer.Serialize(state, JsonOptions));
            File.Move(temporaryPath, statePath, true);
        }
        finally
        {
            if (File.Exists(temporaryPath)) File.Delete(temporaryPath);
        }
    }

    private static RuntimeState RecoveryState() => new(
        1, RuntimeStateStatus.Recovery, "VRCNT", string.Empty, RuntimeVariant.Cpu, "x64", string.Empty,
        string.Empty, string.Empty, DateTimeOffset.UtcNow);
}
