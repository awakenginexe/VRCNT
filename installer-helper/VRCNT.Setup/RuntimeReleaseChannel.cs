using System.Reflection;
using System.IO;
using System.Text.RegularExpressions;
using VRCNT.RuntimeCore.Manager;

namespace VRCNT.Setup;

internal static partial class RuntimeReleaseChannel
{
    private const string ReleaseRoot = "https://github.com/awakenginexe/VRCNT/releases/download/";

    internal static string Tag
    {
        get
        {
            var configured = typeof(RuntimeReleaseChannel).Assembly
                .GetCustomAttributes<AssemblyMetadataAttribute>()
                .FirstOrDefault(attribute => attribute.Key == "VRCNTRuntimeReleaseTag")?.Value;
            return ResolveTag(ManagerCapabilities.Current.Version, configured);
        }
    }

    internal static Uri AssetBaseUri => new($"{ReleaseRoot}{Tag}/");

    internal static string ResolveTag(string version, string? configured)
    {
        var tag = string.IsNullOrWhiteSpace(configured) ? $"v{version}" : configured.Trim();
        if (!ExactTagPattern().IsMatch(tag)) throw new InvalidDataException("The runtime release tag is invalid.");
        return tag;
    }

    [GeneratedRegex("^v[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?$")]
    private static partial Regex ExactTagPattern();
}
