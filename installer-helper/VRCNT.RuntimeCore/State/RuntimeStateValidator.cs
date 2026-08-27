using System.Text.Json;
using VRCNT.RuntimeCore.Models;

namespace VRCNT.RuntimeCore.State;

public sealed class RuntimeStateValidator(IPayloadIdentityValidator payloadIdentityValidator)
{
    public RuntimeState Validate(RuntimeState state)
    {
        if (state.Status != RuntimeStateStatus.Active || state.Schema != 1 ||
            !string.Equals(state.Product, "VRCNT", StringComparison.Ordinal) ||
            !string.Equals(state.Architecture, "x64", StringComparison.Ordinal) ||
            string.IsNullOrWhiteSpace(state.InstallPath) || !Directory.Exists(state.InstallPath))
            return Recover(state);

        try
        {
            var expected = new RuntimeIdentity(
                state.Product, state.Version, state.Variant, state.Architecture, state.MarkerBuildIdentity, state.MarkerSha256);
            payloadIdentityValidator.ReadAndValidate(state.InstallPath, expected);
            return state;
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or InvalidDataException or System.Security.Cryptography.CryptographicException or JsonException)
        {
            return Recover(state);
        }
    }

    private static RuntimeState Recover(RuntimeState state) => state with { Status = RuntimeStateStatus.Recovery };
}
