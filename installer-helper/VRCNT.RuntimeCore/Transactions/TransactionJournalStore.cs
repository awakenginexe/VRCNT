using System.Text.Json;
using System.Text;
using VRCNT.RuntimeCore.Models;

namespace VRCNT.RuntimeCore.Transactions;

public sealed record RuntimeTransactionJournal(
    string TransactionId,
    TransactionPhase Phase,
    string TargetPath,
    string StagingPath,
    string BackupPath,
    RuntimeIdentity ExpectedIdentity,
    bool ActiveMoveIntent,
    bool ActiveRuntimeMoved,
    bool StagedMoveIntent,
    bool StagedRuntimeMoved);

public sealed class TransactionJournalStore
{
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };

    public void WriteAtomic(string journalPath, RuntimeTransactionJournal journal)
    {
        var directory = Path.GetDirectoryName(journalPath) ?? throw new InvalidDataException("The journal path has no parent directory.");
        Directory.CreateDirectory(directory);
        var temporary = Path.Combine(directory, $"transaction.{Guid.NewGuid():N}.tmp");
        try
        {
            var content = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(journal, JsonOptions));
            using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough))
            {
                stream.Write(content);
                stream.Flush(flushToDisk: true);
            }
            File.Move(temporary, journalPath, true);
        }
        finally
        {
            if (File.Exists(temporary)) File.Delete(temporary);
        }
    }

    public RuntimeTransactionJournal Read(string journalPath) => File.Exists(journalPath)
        ? JsonSerializer.Deserialize<RuntimeTransactionJournal>(File.ReadAllText(journalPath), JsonOptions) ?? throw new InvalidDataException("The transaction journal is empty.")
        : throw new FileNotFoundException("The transaction journal is missing.", journalPath);
}
