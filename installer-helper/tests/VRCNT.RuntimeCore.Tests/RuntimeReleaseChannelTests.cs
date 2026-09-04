using VRCNT.Setup;
using Xunit;

namespace VRCNT.RuntimeCore.Tests;

public sealed class RuntimeReleaseChannelTests
{
    [Fact]
    public void ResolveTag_defaults_to_the_exact_stable_version()
    {
        Assert.Equal("v5.15.0", RuntimeReleaseChannel.ResolveTag("5.15.0", null));
    }

    [Fact]
    public void ResolveTag_accepts_the_approved_prerelease_and_rejects_latest()
    {
        Assert.Equal("v5.15.0-rc.1", RuntimeReleaseChannel.ResolveTag("5.15.0", "v5.15.0-rc.1"));
        Assert.Throws<InvalidDataException>(() => RuntimeReleaseChannel.ResolveTag("5.15.0", "latest"));
    }
}
