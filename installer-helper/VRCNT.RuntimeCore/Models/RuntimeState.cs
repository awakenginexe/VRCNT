using System.Text.Json.Serialization;

namespace VRCNT.RuntimeCore.Models;

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum RuntimeStateStatus
{
    Active,
    Activating,
    Recovery,
}

public sealed record RuntimeState(
    int Schema,
    RuntimeStateStatus Status,
    string Product,
    string Version,
    RuntimeVariant Variant,
    string Architecture,
    string InstallPath,
    string MarkerBuildIdentity,
    string MarkerSha256,
    DateTimeOffset UpdatedAtUtc);
