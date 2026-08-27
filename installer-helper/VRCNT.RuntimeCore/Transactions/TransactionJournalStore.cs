using System.Text.Json;
using VRCNT.RuntimeCore.Models;

namespace VRCNT.RuntimeCore.Transactions;

public sealed record RuntimeTransactionJournal(
    string TransactionId,
    TransactionPhase Phase,
    string TargetPath,
    string StagingPath,
    string BackupPath,
    RuntimeIdentity ExpectedIdentity,
    bool ActiveRuntimeMoved,
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
            File.WriteAllText(temporary, JsonSerializer.Serialize(journal, JsonOptions));
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
