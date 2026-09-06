using System.Text.Json.Serialization;

namespace VRCNT.RuntimeCore.Models;

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum RuntimeVariant
{
    Cpu,
    Cuda,
}
