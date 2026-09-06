namespace VRCNT.RuntimeCore.Models;

public sealed record RuntimeIdentity(
    string Product,
    string Version,
    RuntimeVariant Variant,
    string Architecture,
    string BuildIdentity,
    string MarkerSha256);

public sealed record PayloadIdentity(string MarkerPath, RuntimeIdentity Identity);
