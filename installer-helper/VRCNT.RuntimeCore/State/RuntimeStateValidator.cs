using System.Text.Json;
using VRCNT.RuntimeCore.Models;

namespace VRCNT.RuntimeCore.State;

public sealed class RuntimeStateValidator(IPayloadIdentityValidator payloadIdentityValidator)
{
    public RuntimeState Validate(RuntimeState state, string canonicalInstallPath, VariantPackage expectedPackage)
    {
        if (state.Status != RuntimeStateStatus.Active || state.Schema != 1 ||
            !string.Equals(state.Product, "VRCNT", StringComparison.Ordinal) ||
            !string.Equals(state.Architecture, "x64", StringComparison.Ordinal) ||
            string.IsNullOrWhiteSpace(state.InstallPath) || !PathsEqual(state.InstallPath, canonicalInstallPath) ||
            !Directory.Exists(canonicalInstallPath) || !File.Exists(Path.Combine(canonicalInstallPath, "VRCNT.exe")) ||
            !File.Exists(Path.Combine(canonicalInstallPath, "VRCNT-backend.exe")) || !MatchesExpectedIdentity(state, expectedPackage.Identity))
            return Recover(state);

        try
        {
            payloadIdentityValidator.ReadAndValidate(canonicalInstallPath, expectedPackage.MarkerPath, expectedPackage.Identity);
            return state;
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or InvalidDataException or System.Security.Cryptography.CryptographicException or JsonException)
        {
            return Recover(state);
        }
    }

    private static RuntimeState Recover(RuntimeState state) => state with { Status = RuntimeStateStatus.Recovery };

    private static bool MatchesExpectedIdentity(RuntimeState state, RuntimeIdentity identity) =>
        string.Equals(state.Product, identity.Product, StringComparison.Ordinal) &&
        string.Equals(state.Version, identity.Version, StringComparison.Ordinal) &&
        state.Variant == identity.Variant &&
        string.Equals(state.Architecture, identity.Architecture, StringComparison.Ordinal) &&
        string.Equals(state.MarkerBuildIdentity, identity.BuildIdentity, StringComparison.Ordinal) &&
        string.Equals(state.MarkerSha256, identity.MarkerSha256, StringComparison.OrdinalIgnoreCase);

    private static bool PathsEqual(string left, string right)
    {
        try { return string.Equals(Path.GetFullPath(left), Path.GetFullPath(right), StringComparison.OrdinalIgnoreCase); }
        catch (Exception exception) when (exception is ArgumentException or NotSupportedException) { return false; }
    }
}
