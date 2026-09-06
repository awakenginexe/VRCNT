namespace VRCNT.Setup.Views;

public interface IInstallDirectoryPicker
{
    string? PickDirectory(string initialDirectory);
}

public sealed class NullInstallDirectoryPicker : IInstallDirectoryPicker
{
    public string? PickDirectory(string initialDirectory) => null;
}
