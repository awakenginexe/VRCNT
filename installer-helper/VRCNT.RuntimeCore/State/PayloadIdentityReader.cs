using System.Security.Cryptography;
using System.Text.Json;
using VRCNT.RuntimeCore.Models;

namespace VRCNT.RuntimeCore.State;

public interface IPayloadIdentityValidator
{
    PayloadIdentity ReadAndValidate(string installPath, RuntimeIdentity expectedIdentity);
}

public sealed class PayloadIdentityReader : IPayloadIdentityValidator
{
    private const string MarkerFileName = "VRCNT.runtime.json";
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };

    public PayloadIdentity ReadAndValidate(string installPath, RuntimeIdentity expectedIdentity)
    {
        if (!Directory.Exists(installPath)) throw new DirectoryNotFoundException("The runtime install path does not exist.");
        var markerPath = Path.Combine(installPath, MarkerFileName);
        if (!File.Exists(markerPath)) throw new InvalidDataException("The runtime marker is missing.");

        var marker = JsonSerializer.Deserialize<MarkerIdentity>(File.ReadAllText(markerPath), JsonOptions)
            ?? throw new InvalidDataException("The runtime marker is empty.");
        if (!string.Equals(marker.Product, expectedIdentity.Product, StringComparison.Ordinal) ||
            !string.Equals(marker.Version, expectedIdentity.Version, StringComparison.Ordinal) ||
            marker.Variant != expectedIdentity.Variant ||
            !string.Equals(marker.Architecture, expectedIdentity.Architecture, StringComparison.Ordinal) ||
            !string.Equals(marker.BuildIdentity, expectedIdentity.BuildIdentity, StringComparison.Ordinal))
            throw new InvalidDataException("The runtime marker identity does not match the selected runtime.");

        var markerSha256 = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(markerPath))).ToLowerInvariant();
        if (!string.Equals(markerSha256, expectedIdentity.MarkerSha256, StringComparison.OrdinalIgnoreCase))
            throw new CryptographicException("The runtime marker hash does not match the signed manifest.");

        return new PayloadIdentity(markerPath, expectedIdentity with { MarkerSha256 = markerSha256 });
    }

    private sealed record MarkerIdentity(string Product, string Version, RuntimeVariant Variant, string Architecture, string BuildIdentity);
}
