using VRCNT.RuntimeCore.Models;
using VRCNT.RuntimeCore.Migration;
using VRCNT.RuntimeCore.Paths;
using Xunit;

namespace VRCNT.RuntimeCore.Tests;

public sealed class LegacyMigrationTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));

    [Fact]
    public void Resolve_uses_vrcnt_data_and_exposes_legacy_and_install_local_sources()
    {
        var localAppData = Path.Combine(_root, "local-app-data");
        var installPath = Path.Combine(_root, "install");

        var paths = new UserDataPathResolver().Resolve(localAppData, installPath);

        Assert.Equal(Path.Combine(localAppData, "VRCNTData"), paths.DataRoot);
        Assert.Equal(Path.Combine(localAppData, "VRCNT-NextData"), paths.LegacyDataRoot);
        Assert.Equal(installPath, paths.InstallPath);
    }

    [Fact]
    public void ValidateCustomInstallPath_rejects_another_users_profile_path()
    {
        var userProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        var anotherUserInstallPath = Path.Combine(Directory.GetParent(userProfile)!.FullName, "another-user", "VRCNT");

        Assert.Throws<InvalidDataException>(() => new UserDataPathResolver()
            .Resolve(Path.Combine(_root, "local-app-data"), anotherUserInstallPath));
    }

    [Fact]
    public void PreserveUserData_copies_legacy_and_install_local_files_without_overwriting_user_data()
    {
        var localAppData = Path.Combine(_root, "local-app-data");
        var installPath = Path.Combine(_root, "install");
        var dataRoot = Path.Combine(localAppData, "VRCNTData");
        Write(Path.Combine(dataRoot, "config.json"), "current-config");
        Write(Path.Combine(dataRoot, "weights", "current.bin"), "current-weight");
        Write(Path.Combine(dataRoot, "logs", "current.log"), "current-log");
        Write(Path.Combine(localAppData, "VRCNT-NextData", "config.json"), "legacy-config");
        Write(Path.Combine(localAppData, "VRCNT-NextData", "weights", "legacy.bin"), "legacy-weight");
        Write(Path.Combine(localAppData, "VRCNT-NextData", "logs", "legacy.log"), "legacy-log");
        Write(Path.Combine(installPath, "config.json"), "install-config");
        Write(Path.Combine(installPath, "weights", "install.bin"), "install-weight");
        Write(Path.Combine(installPath, "logs", "install.log"), "install-log");

        var detector = new LegacyInstallationDetector(new UserDataPathResolver());
        var legacy = detector.Detect(localAppData, installPath);
        detector.PreserveUserData(legacy);

        Assert.True(legacy.RequiresMigration);
        Assert.Equal("current-config", File.ReadAllText(Path.Combine(dataRoot, "config.json")));
        Assert.Equal("current-weight", File.ReadAllText(Path.Combine(dataRoot, "weights", "current.bin")));
        Assert.Equal("current-log", File.ReadAllText(Path.Combine(dataRoot, "logs", "current.log")));
        Assert.Equal("legacy-weight", File.ReadAllText(Path.Combine(dataRoot, "weights", "legacy.bin")));
        Assert.Equal("legacy-log", File.ReadAllText(Path.Combine(dataRoot, "logs", "legacy.log")));
        Assert.Equal("install-weight", File.ReadAllText(Path.Combine(dataRoot, "weights", "install.bin")));
        Assert.Equal("install-log", File.ReadAllText(Path.Combine(dataRoot, "logs", "install.log")));
        Assert.True(File.Exists(Path.Combine(localAppData, "VRCNT-NextData", "config.json")));
        Assert.True(File.Exists(Path.Combine(installPath, "config.json")));
    }

    [Fact]
    public void Detect_classifies_a_pre_5_15_payload_without_a_runtime_marker_as_migration()
    {
        var localAppData = Path.Combine(_root, "local-app-data");
        var installPath = Path.Combine(_root, "install");
        Write(Path.Combine(installPath, "VRCNT.exe"), "legacy-app");

        var legacy = new LegacyInstallationDetector(new UserDataPathResolver()).Detect(localAppData, installPath);

        Assert.True(legacy.RequiresMigration);
        Assert.False(legacy.HasRuntimeMarker);
        Assert.Null(legacy.DetectedVariant);
    }

    [Fact]
    public void Detect_maps_a_legacy_payload_with_cuda_boundaries_to_cuda()
    {
        var installPath = Path.Combine(_root, "cuda-install");
        Write(Path.Combine(installPath, "VRCNT.exe"), "legacy-app");
        Write(Path.Combine(installPath, "_internal", "onnxruntime", "capi", "onnxruntime_providers_cuda.dll"), "cuda");

        var legacy = new LegacyInstallationDetector(new UserDataPathResolver()).Detect(
            Path.Combine(_root, "local-app-data"), installPath);

        Assert.Equal(RuntimeVariant.Cuda, legacy.DetectedVariant);
        Assert.True(legacy.RequiresMigration);
    }

    [Fact]
    public void Detect_maps_a_legacy_payload_without_cuda_boundaries_to_cpu()
    {
        var installPath = Path.Combine(_root, "cpu-install");
        Write(Path.Combine(installPath, "VRCNT.exe"), "legacy-app");
        Write(Path.Combine(installPath, "_internal", "onnxruntime", "capi", "onnxruntime.dll"), "cpu");

        var legacy = new LegacyInstallationDetector(new UserDataPathResolver()).Detect(
            Path.Combine(_root, "local-app-data"), installPath);

        Assert.Equal(RuntimeVariant.Cpu, legacy.DetectedVariant);
    }

    [Fact]
    public void Detect_requires_explicit_selection_for_data_only_unknown_installations()
    {
        var localAppData = Path.Combine(_root, "local-app-data");
        Write(Path.Combine(localAppData, "VRCNT-NextData", "config.json"), "legacy-config");

        var legacy = new LegacyInstallationDetector(new UserDataPathResolver()).Detect(
            localAppData, Path.Combine(_root, "unknown-install"));

        Assert.True(legacy.RequiresMigration);
        Assert.Null(legacy.DetectedVariant);
    }

    [Fact]
    public void A_stale_marker_bearing_installation_is_not_treated_as_markerless_migration()
    {
        var installPath = Path.Combine(_root, "stale-install");
        Write(Path.Combine(installPath, "VRCNT.exe"), "legacy-app");
        Write(Path.Combine(installPath, "VRCNT.runtime.json"), "stale-marker");

        var legacy = new LegacyInstallationDetector(new UserDataPathResolver()).Detect(
            Path.Combine(_root, "local-app-data"), installPath);

        Assert.True(legacy.HasRuntimeMarker);
        Assert.False(legacy.RequiresMigration);
    }

    [Fact]
    public void Legacy_aware_state_transition_allows_only_a_markerless_legacy_payload()
    {
        var installPath = Path.Combine(_root, "legacy-install");
        Write(Path.Combine(installPath, "VRCNT.exe"), "legacy-app");
        var paths = new UserDataPathResolver();
        var detector = new LegacyInstallationDetector(paths);
        var transition = new LegacyAwareRuntimeStateTransition(
            new RejectingStateTransition(), detector, paths);

        transition.ValidateExistingRuntime(installPath);

        Write(Path.Combine(installPath, "VRCNT.runtime.json"), "stale-marker");
        Assert.Throws<InvalidDataException>(() => transition.ValidateExistingRuntime(installPath));
    }

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, true);
    }

    private static void Write(string path, string content)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, content);
    }

    private sealed class RejectingStateTransition : VRCNT.RuntimeCore.Transactions.IRuntimeStateTransition
    {
        public void ValidateExistingRuntime(string installPath) => throw new InvalidDataException("state is not active");
        public void WriteActiveRuntime(string installPath, RuntimeIdentity identity) => throw new NotSupportedException();
    }
}
