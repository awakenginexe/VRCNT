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

    [Theory]
    [InlineData("activity_history")]
    [InlineData("phase_preparing")]
    [InlineData("phase_downloading")]
    [InlineData("phase_verifying")]
    [InlineData("phase_extracting")]
    [InlineData("phase_installing")]
    [InlineData("phase_finalizing")]
    [InlineData("installed_edition")]
    [InlineData("active_status")]
    public void New_installer_localization_keys_exist_in_every_supported_locale(string key)
    {
        var repoRoot = FindRepoRoot();
        var jsonPath = Path.Combine(repoRoot, "installer-helper", "VRCNT.Setup", "obj", "Generated", "InstallerLocales.json");
        if (File.Exists(jsonPath))
        {
            using var doc = System.Text.Json.JsonDocument.Parse(File.ReadAllText(jsonPath));
            var translations = doc.RootElement.GetProperty("translations");
            foreach (var language in SupportedLanguages)
            {
                Assert.True(translations.TryGetProperty(language, out var langObj), $"Language {language} missing in catalog");
                Assert.True(langObj.TryGetProperty(key, out var val), $"Key {key} missing in {language}");
                Assert.False(string.IsNullOrWhiteSpace(val.GetString()), $"Key {key} empty in {language}");
            }
        }
        else
        {
            foreach (var language in SupportedLanguages)
            {
                var ymlPath = Path.Combine(repoRoot, "locales", $"{language}.yml");
                var lines = File.ReadAllLines(ymlPath);
                Assert.Contains(lines, l => l.TrimStart().StartsWith(key + ":", StringComparison.Ordinal));
            }
        }
    }

    private static string FindRepoRoot()
    {
        var current = new DirectoryInfo(AppContext.BaseDirectory);
        while (current != null && !File.Exists(Path.Combine(current.FullName, "package.json")))
        {
            current = current.Parent;
        }

        return current?.FullName ?? throw new InvalidOperationException("Could not find repository root.");
    }
}
