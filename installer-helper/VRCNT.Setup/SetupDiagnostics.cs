using System.IO;

namespace VRCNT.Setup;

internal static class SetupDiagnostics
{
    internal static string DescribeFailure(Exception exception)
    {
        try
        {
            var directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "VRCNTInstaller", "logs");
            Directory.CreateDirectory(directory);
            var path = Path.Combine(directory, $"setup-{DateTime.UtcNow:yyyyMMdd}-{Environment.ProcessId}.log");
            File.AppendAllText(path, $"[{DateTimeOffset.UtcNow:O}] {exception}\n\n");
            return $"{exception.Message}\n\nLog: {path}";
        }
        catch (Exception) { return exception.Message; }
    }
}
