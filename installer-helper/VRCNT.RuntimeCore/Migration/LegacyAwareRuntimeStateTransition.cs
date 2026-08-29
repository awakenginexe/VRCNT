using VRCNT.RuntimeCore.Models;
using VRCNT.RuntimeCore.Paths;
using VRCNT.RuntimeCore.Transactions;

namespace VRCNT.RuntimeCore.Migration;

/// <summary>Allows only a positively identified marker-less legacy install through migration.</summary>
public sealed class LegacyAwareRuntimeStateTransition(
    IRuntimeStateTransition authenticatedTransition,
    LegacyInstallationDetector legacyDetector,
    UserDataPathResolver pathResolver) : IRuntimeStateTransition
{
    public void ValidateExistingRuntime(string installPath)
    {
        try
        {
            authenticatedTransition.ValidateExistingRuntime(installPath);
        }
        catch (InvalidDataException) when (legacyDetector.Detect(pathResolver.Resolve(installPath)).RequiresMigration)
        {
            // A marker-less pre-5.15 installation is migrated after its user data is preserved.
        }
    }

    public void WriteActiveRuntime(string installPath, RuntimeIdentity identity) =>
        authenticatedTransition.WriteActiveRuntime(installPath, identity);
}
