using System.Reflection;
using System.Text.Json;

namespace VRCNT.Setup.Localization;

public sealed record InstallerLanguage(string Id, string Name);

public sealed class InstallerLocalizer
{
    private const string ResourceName = "VRCNT.Setup.InstallerLocales.json";
    private readonly IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>> _translations;

    private InstallerLocalizer(
        IReadOnlyList<InstallerLanguage> languages,
        IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>> translations,
        string initialLanguage)
    {
        Languages = languages;
        _translations = translations;
        CurrentLanguage = initialLanguage;
    }

    public event EventHandler? LanguageChanged;

    public IReadOnlyList<InstallerLanguage> Languages { get; }

    public string CurrentLanguage { get; private set; }

    public string this[string key] =>
        _translations[CurrentLanguage].TryGetValue(key, out var translation)
            ? translation
            : throw new KeyNotFoundException($"Installer translation '{key}' is missing for {CurrentLanguage}.");

    public static InstallerLocalizer FromEmbedded(Assembly? assembly = null)
    {
        assembly ??= typeof(InstallerLocalizer).Assembly;
        using var stream = assembly.GetManifestResourceStream(ResourceName)
            ?? throw new InvalidOperationException("The embedded installer locale catalog is unavailable.");
        using var document = JsonDocument.Parse(stream);
        var root = document.RootElement;
        var languages = root.GetProperty("languages").EnumerateArray()
            .Select(item => new InstallerLanguage(item.GetProperty("id").GetString()!, item.GetProperty("name").GetString()!))
            .ToArray();
        var translations = root.GetProperty("translations").EnumerateObject()
            .ToDictionary(
                language => language.Name,
                language => (IReadOnlyDictionary<string, string>)language.Value.EnumerateObject()
                    .ToDictionary(item => item.Name, item => item.Value.GetString()!),
                StringComparer.Ordinal);
        if (languages.Length == 0 || languages.Any(language => !translations.ContainsKey(language.Id)))
            throw new InvalidOperationException("The embedded installer locale catalog is incomplete.");
        return new InstallerLocalizer(languages, translations, languages[0].Id);
    }

    public void SetLanguage(string languageId)
    {
        if (!_translations.ContainsKey(languageId))
            throw new ArgumentException("The installer language is not supported.", nameof(languageId));
        if (StringComparer.Ordinal.Equals(CurrentLanguage, languageId)) return;
        CurrentLanguage = languageId;
        LanguageChanged?.Invoke(this, EventArgs.Empty);
    }
}
