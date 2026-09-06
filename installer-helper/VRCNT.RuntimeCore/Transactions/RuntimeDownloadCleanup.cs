namespace VRCNT.RuntimeCore.Transactions;

public static class RuntimeDownloadCleanup
{
    public static void AfterSuccess(bool succeeded, string cacheDirectory, IEnumerable<string> names)
    {
        if (!succeeded) return;
        try
        {
            // Never traverse redirected cache directories or delete caller-owned folders.
            for (var directory = new DirectoryInfo(cacheDirectory); directory is not null; directory = directory.Parent)
                if (directory.Exists && directory.Attributes.HasFlag(FileAttributes.ReparsePoint)) return;
            foreach (var name in names)
            {
                if (string.IsNullOrWhiteSpace(name) || name != Path.GetFileName(name) || name is "." or "..") continue;
                foreach (var suffix in new[] { "", ".partial" })
                {
                    try { File.Delete(Path.Combine(cacheDirectory, name + suffix)); }
                    catch (IOException) { }
                    catch (UnauthorizedAccessException) { }
                }
            }
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
        // Cache cleanup must not turn a committed installation into a failed one.
    }
}
