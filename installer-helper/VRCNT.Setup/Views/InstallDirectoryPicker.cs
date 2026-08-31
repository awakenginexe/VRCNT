using System.IO;
using Microsoft.Win32;

namespace VRCNT.Setup.Views;

public sealed class InstallDirectoryPicker : IInstallDirectoryPicker
{
    public string? PickDirectory(string initialDirectory)
    {
        var dialog = new OpenFolderDialog
        {
            Title = "Choose VRCNT installation folder",
            InitialDirectory = Directory.Exists(initialDirectory) ? initialDirectory : string.Empty,
        };
        return dialog.ShowDialog() == true ? dialog.FolderName : null;
    }
}
