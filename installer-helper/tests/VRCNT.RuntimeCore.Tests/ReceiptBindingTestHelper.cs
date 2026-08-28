using System.Runtime.InteropServices;
using System.Text.Json;
using VRCNT.RuntimeCore.Manager;

namespace VRCNT.RuntimeCore.Tests;

internal static class ReceiptBindingTestHelper
{
    public const string DefaultSecret = "receipt-secret-012345678901234567890123456789";

    public static void Write(string dataRoot, string nonce, string target, string installPath, string appPath, string token, long generation, string receiptSecret)
    {
        Directory.CreateDirectory(dataRoot);
        var expiresAtUnixMs = DateTimeOffset.UtcNow.AddHours(24).ToUnixTimeMilliseconds();
        var binding = JsonSerializer.SerializeToUtf8Bytes(new
        {
            schema = 1,
            nonce,
            targetVariant = target,
            installPath = Path.GetFullPath(installPath),
            currentAppPath = Path.GetFullPath(appPath),
            token,
            tokenSha256 = RuntimeSwitchStatusStore.Hash(token),
            proofSha256 = RuntimeSwitchStatusStore.Proof(token, nonce, target, appPath),
            leaseGeneration = generation,
            receiptSecret,
            receiptExpiresAtUnixMs = expiresAtUnixMs,
        });
        File.WriteAllText(Path.Combine(dataRoot, $"runtime-switch-receipt-{nonce}.json"), JsonSerializer.Serialize(new
        {
            schema = 1,
            nonce,
            protectedBinding = Convert.ToBase64String(Protect(binding)),
        }));
    }

    private static byte[] Protect(byte[] value)
    {
        var input = new DataBlob { Length = (uint)value.Length, Data = Marshal.AllocHGlobal(value.Length) };
        try
        {
            Marshal.Copy(value, 0, input.Data, value.Length);
            if (CryptProtectData(ref input, null, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 1, out var output) == 0)
                throw new InvalidOperationException("DPAPI test binding protection failed.");
            try
            {
                var result = new byte[output.Length];
                Marshal.Copy(output.Data, result, 0, result.Length);
                return result;
            }
            finally { LocalFree(output.Data); }
        }
        finally { Marshal.FreeHGlobal(input.Data); }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct DataBlob { public uint Length; public IntPtr Data; }

    [DllImport("crypt32.dll", SetLastError = true)]
    private static extern int CryptProtectData(ref DataBlob input, string? description, IntPtr entropy, IntPtr reserved, IntPtr prompt, int flags, out DataBlob output);

    [DllImport("kernel32.dll")]
    private static extern IntPtr LocalFree(IntPtr memory);
}
