using VRCNT.RuntimeCore.Packages;
using Xunit;

namespace VRCNT.RuntimeCore.Tests;

public sealed class CpuPayloadValidatorTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));

    [Fact]
    public void ValidateStagedPayload_rejects_cuda_only_dll_before_destination_replacement()
    {
        Directory.CreateDirectory(_root);
        File.WriteAllText(Path.Combine(_root, "VRCNT.exe"), "app");
        File.WriteAllText(Path.Combine(_root, "torch_cuda.dll"), "cuda");

        var exception = Assert.Throws<InvalidDataException>(() => CpuPayloadValidator.ValidateStagedPayload(_root));

        Assert.Contains("torch_cuda.dll", exception.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void ValidateStagedPayload_accepts_cpu_tree()
    {
        Directory.CreateDirectory(_root);
        File.WriteAllText(Path.Combine(_root, "VRCNT.exe"), "app");
        File.WriteAllText(Path.Combine(_root, "onnxruntime.dll"), "cpu");

        CpuPayloadValidator.ValidateStagedPayload(_root);
    }

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, true);
    }
}
