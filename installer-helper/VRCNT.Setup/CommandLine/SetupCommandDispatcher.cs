using VRCNT.RuntimeCore.Models;

namespace VRCNT.Setup.CommandLine;

public interface ISetupCommandOperations
{
    Task ExecuteRuntimeAsync(SetupCommandLineOptions options, CancellationToken cancellationToken);
    Task ExecuteRepairManagerAsync(SetupCommandLineOptions options, CancellationToken cancellationToken);
    Task HandoffToCurrentAppAsync(SetupCommandLineOptions options, CancellationToken cancellationToken);
}

public sealed class SetupCommandDispatcher(ISetupCommandOperations operations)
{
    private readonly ISetupCommandOperations _operations = operations ?? throw new ArgumentNullException(nameof(operations));

    public async Task<int> DispatchAsync(SetupCommandLineOptions options, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(options);
        if (options.IsRepairManager)
            await _operations.ExecuteRepairManagerAsync(options, cancellationToken);
        else
            await _operations.ExecuteRuntimeAsync(options, cancellationToken);

        if (options.CurrentAppPath is not null && (!options.IsRepairManager || options.IsManagerRepairWorker))
            await _operations.HandoffToCurrentAppAsync(options, cancellationToken);
        return 0;
    }
}
