using VRCNT.RuntimeCore.Paths;

namespace VRCNT.RuntimeCore.Filesystem;

public sealed record RuntimeTransactionPaths(string TransactionRoot, string StagingPath, string BackupPath, string JournalPath)
{
    public static RuntimeTransactionPaths For(string installPath, string transactionId)
    {
        var target = Path.GetFullPath(installPath);
        var parent = Path.GetDirectoryName(target) ?? throw new InvalidDataException("The install path has no parent directory.");
        var root = Path.Combine(parent, ".vrcnt-transactions", transactionId);
        return new RuntimeTransactionPaths(root, Path.Combine(root, "staging"), Path.Combine(root, "backup"), Path.Combine(root, "transaction.json"));
    }
}

public sealed class RuntimePathValidator(IVolumeIdentityProbe volumeIdentityProbe)
{
    public RuntimeTransactionPaths CreateTransactionPaths(string installPath, string transactionId)
    {
        var target = new UserDataPathResolver().ValidateCustomInstallPath(installPath);
        RejectReparsePointParents(target);
        var paths = RuntimeTransactionPaths.For(target, transactionId);
        var identities = new[] { target, paths.TransactionRoot, paths.StagingPath, paths.BackupPath, paths.JournalPath }
            .Select(volumeIdentityProbe.GetVolumeIdentity)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
        if (identities.Length != 1) throw new InvalidDataException("Runtime staging, journal, backup, and target must be on the same volume.");
        return paths;
    }

    public string GetTransactionContainer(string installPath)
    {
        var target = new UserDataPathResolver().ValidateCustomInstallPath(installPath);
        return Path.Combine(Path.GetDirectoryName(target)!, ".vrcnt-transactions");
    }

    private static void RejectReparsePointParents(string target)
    {
        for (var current = new DirectoryInfo(Path.GetDirectoryName(target)!); current is not null; current = current.Parent)
        {
            if (current.Exists && current.Attributes.HasFlag(FileAttributes.ReparsePoint))
                throw new InvalidDataException("The install path cannot traverse a reparse point.");
        }
    }
}
