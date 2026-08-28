using VRCNT.Setup.CommandLine;
using VRCNT.Setup.Localization;
using Xunit;

namespace VRCNT.RuntimeCore.Tests;

public sealed class InstallerLocalizationTests
{
    private static readonly string[] SupportedLanguages = ["en", "ja", "ko", "th", "zh-Hant", "zh-Hans"];

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

    [Fact]
    public void Localizer_and_command_line_use_the_same_generated_language_manifest()
    {
        var localizer = InstallerLocalizer.FromCatalog(
            SupportedLanguages.Select(id => new InstallerLanguage(id, id)).ToArray(),
            SupportedLanguages.ToDictionary(id => id, id => (IReadOnlyDictionary<string, string>)new Dictionary<string, string> { ["app_name"] = "VRCNT" }, StringComparer.Ordinal));

        Assert.Equal(SupportedLanguages, localizer.Languages.Select(language => language.Id));
        Assert.All(SupportedLanguages, language => Assert.Equal(language, SetupCommandLine.Parse(["--installer-language", language]).InstallerLanguage));
    }

}
