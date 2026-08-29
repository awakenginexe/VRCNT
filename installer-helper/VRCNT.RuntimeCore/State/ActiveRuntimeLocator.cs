using VRCNT.RuntimeCore.Models;
using VRCNT.RuntimeCore.Paths;

namespace VRCNT.RuntimeCore.State;

public sealed record ActiveRuntime(RuntimeVariant Variant, string InstallPath, string CurrentAppPath);

public interface IActiveRuntimeLocator
{
    ActiveRuntime Resolve();
}

public sealed class ActiveRuntimeLocator : IActiveRuntimeLocator
{
    private const string MarkerPath = "VRCNT.runtime.json";
    private readonly IRuntimeStateStore _stateStore;
    private readonly IPayloadIdentityValidator _payloadIdentityValidator;
    private readonly UserDataPathResolver _paths;
    private readonly Func<string> _resolveDataRoot;

    public ActiveRuntimeLocator(
        IRuntimeStateStore? stateStore = null,
        IPayloadIdentityValidator? payloadIdentityValidator = null,
        UserDataPathResolver? paths = null,
        Func<string>? resolveDataRoot = null)
    {
        _stateStore = stateStore ?? new RuntimeStateStore();
        _payloadIdentityValidator = payloadIdentityValidator ?? new PayloadIdentityReader();
        _paths = paths ?? new UserDataPathResolver();
        _resolveDataRoot = resolveDataRoot ?? _paths.ResolveDataRoot;
    }

    public ActiveRuntime Resolve() => Resolve(_resolveDataRoot());

    public ActiveRuntime Resolve(string dataRoot)
    {
        var state = _stateStore.Read(dataRoot);
        if (state.Schema != 1 || state.Status != RuntimeStateStatus.Active ||
            !string.Equals(state.Product, "VRCNT", StringComparison.Ordinal) ||
            !string.Equals(state.Architecture, "x64", StringComparison.Ordinal) ||
            string.IsNullOrWhiteSpace(state.Version) ||
            string.IsNullOrWhiteSpace(state.MarkerBuildIdentity) ||
            string.IsNullOrWhiteSpace(state.MarkerSha256))
            throw new InvalidDataException("The installed VRCNT runtime state is not active and authenticated.");

        var installPath = _paths.ValidateCustomInstallPath(state.InstallPath);
        if (!string.Equals(installPath, state.InstallPath, StringComparison.OrdinalIgnoreCase) ||
            !File.Exists(Path.Combine(installPath, "VRCNT.exe")) ||
            !File.Exists(Path.Combine(installPath, "VRCNT-backend.exe")))
            throw new InvalidDataException("The installed VRCNT runtime path is unavailable.");

        var identity = new RuntimeIdentity(
            state.Product,
            state.Version,
            state.Variant,
            state.Architecture,
            state.MarkerBuildIdentity,
            state.MarkerSha256);
        _payloadIdentityValidator.ReadAndValidate(installPath, MarkerPath, identity);
        return new ActiveRuntime(state.Variant, installPath, Path.Combine(installPath, "VRCNT.exe"));
    }
}
