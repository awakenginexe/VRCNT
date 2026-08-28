using VRCNT.Setup.CommandLine;
using Xunit;

namespace VRCNT.RuntimeCore.Tests;

public sealed class InstallerLocalizationTests
{
    [Theory]
    [InlineData("en")]
    [InlineData("ja")]
    [InlineData("ko")]
    [InlineData("th")]
    [InlineData("zh-Hant")]
    [InlineData("zh-Hans")]
    public void Command_line_accepts_each_supported_installer_language(string language)
    {
        var options = SetupCommandLine.Parse(["--installer-language", language]);

        Assert.Equal(language, options.InstallerLanguage);
    }

    [Theory]
    [InlineData("fr")]
    [InlineData("zh-TW")]
    [InlineData("")]
    public void Command_line_rejects_unsupported_installer_languages(string language)
    {
        Assert.Throws<ArgumentException>(() => SetupCommandLine.Parse(["--installer-language", language]));
    }

}
