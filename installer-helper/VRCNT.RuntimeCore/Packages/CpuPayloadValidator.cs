namespace VRCNT.RuntimeCore.Packages;

public static class CpuPayloadValidator
{
    private static readonly string[] CudaOnlyDllTokens = [
        "cuda", "cudnn", "cublas", "cufft", "curand", "cusolver", "cusparse", "nvrtc", "nvinfer", "torch_cuda",
    ];

    public static void ValidateStagedPayload(string stagingDirectory)
    {
        if (!File.Exists(Path.Combine(stagingDirectory, "VRCNT.exe")))
            throw new InvalidDataException("Staged CPU payload is missing VRCNT.exe.");

        var cudaLibrary = Directory.EnumerateFiles(stagingDirectory, "*.dll", SearchOption.AllDirectories)
            .FirstOrDefault(path => CudaOnlyDllTokens.Any(token => Path.GetFileName(path).Contains(token, StringComparison.OrdinalIgnoreCase)));
        if (cudaLibrary is not null)
            throw new InvalidDataException($"CPU payload contains CUDA-only library '{Path.GetFileName(cudaLibrary)}'.");
    }
}
