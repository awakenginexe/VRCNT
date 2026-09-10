using System.Text.Json;

namespace VRCNT.RuntimeCore.Manager;

public sealed record ManagerState(
    string ManagerPath,
    string ManagerSha256,
    string Version,
    int ManagerProtocol,
    int ManifestSchema,
    int RuntimeStateSchema,
    int ActivationProtocol,
    bool LastSelfCheckSucceeded,
    string? LastFailureCode,
    DateTimeOffset UpdatedAtUtc);

public sealed class ManagerStateStore
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true, WriteIndented = true };

    public ManagerStateStore(string? localAppData = null, ManagerCapabilities? capabilities = null, string? managerPath = null)
    {
        var root = localAppData ?? Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        ManagerDirectory = Path.GetFullPath(Path.Combine(root, "VRCNTInstaller"));
        ManagerPath = Path.GetFullPath(managerPath ?? Path.Combine(ManagerDirectory, "VRCNT.Setup.exe"));
        Capabilities = capabilities ?? ManagerCapabilities.Current;
    }

    public string ManagerDirectory { get; }
    public string ManagerPath { get; }
    public string StatePath => Path.Combine(ManagerDirectory, "manager-state.json");
    public string SignaturePath => ManagerPath + ".sig";
    public ManagerCapabilities Capabilities { get; }

    public ManagerState? Read()
    {
        try
        {
            if (!File.Exists(StatePath)) return null;
            return JsonSerializer.Deserialize<ManagerState>(File.ReadAllText(StatePath), JsonOptions);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or JsonException)
        {
            return null;
        }
    }

    public string? ReadSignature()
    {
        try
        {
            return File.Exists(SignaturePath) ? File.ReadAllText(SignaturePath) : null;
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    public void Write(ManagerState state)
    {
        Directory.CreateDirectory(ManagerDirectory);
        var temporaryPath = Path.Combine(ManagerDirectory, $"manager-state.{Guid.NewGuid():N}.tmp");
        try
        {
            File.WriteAllText(temporaryPath, JsonSerializer.Serialize(state, JsonOptions));
            File.Move(temporaryPath, StatePath, true);
        }
        finally
        {
            if (File.Exists(temporaryPath)) File.Delete(temporaryPath);
        }
    }

    public void WriteAuthenticated(ManagerState state, string signedManagerPath)
    {
        if (string.IsNullOrWhiteSpace(signedManagerPath) || !File.Exists(signedManagerPath))
            throw new FileNotFoundException("The authenticated manager signature is missing.", signedManagerPath);
        Directory.CreateDirectory(ManagerDirectory);
        var previousSignature = File.Exists(SignaturePath) ? File.ReadAllBytes(SignaturePath) : null;
        var signatureMoved = false;
        var temporaryPath = SignaturePath + $".{Guid.NewGuid():N}.tmp";
        try
        {
            File.Copy(signedManagerPath, temporaryPath, true);
            File.Move(temporaryPath, SignaturePath, true);
            signatureMoved = true;
            Write(state); // Publish state only after its signature is in place.
        }
        catch (Exception failure)
        {
            if (signatureMoved)
            {
                try
                {
                    if (previousSignature is null) File.Delete(SignaturePath);
                    else
                    {
                        File.WriteAllBytes(temporaryPath, previousSignature);
                        File.Move(temporaryPath, SignaturePath, true);
                    }
                }
                catch (Exception rollbackFailure)
                {
                    throw new AggregateException("Manager signature rollback failed.", failure, rollbackFailure);
                }
            }
            throw;
        }
        finally
        {
            if (File.Exists(temporaryPath)) File.Delete(temporaryPath);
        }
    }
}
