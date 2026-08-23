import json
import tempfile
import unittest
from unittest import mock
from pathlib import Path
import sys


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
UTILS_DIRECTORY = REPOSITORY_ROOT / "utils"
sys.path.insert(0, str(UTILS_DIRECTORY))


from virustotal import (
    BADGE_FILENAME,
    DIRECT_UPLOAD_LIMIT_BYTES,
    DIRECT_UPLOAD_URL,
    FILE_BADGE_FILENAMES,
    HttpTransport,
    LARGE_UPLOAD_URL,
    REPORT_FILENAME,
    ScanResult,
    VirusTotalClient,
    VirusTotalError,
    build_report,
    run,
    update_readme_artifacts,
    write_report_artifacts,
)


class RecordingTransport:
    def __init__(self):
        self.json_requests = []
        self.uploads = []

    def request_json(self, method, url):
        self.json_requests.append((method, url))
        if url == LARGE_UPLOAD_URL:
            return {"data": "https://upload.example.invalid/one-time"}
        raise AssertionError(f"Unexpected JSON request: {method} {url}")

    def upload_file(self, url, file_path):
        self.uploads.append((url, Path(file_path).name))
        return {"data": {"id": f"analysis-{Path(file_path).name}"}}


class VirusTotalUploadTests(unittest.TestCase):
    def test_malformed_upload_response_does_not_expose_a_one_time_upload_url(self):
        upload_url = "https://upload.example.invalid/single-use-upload-token"

        with self.assertRaises(VirusTotalError) as raised:
            HttpTransport._decode_json(b"not-json", upload_url)

        self.assertNotIn("single-use-upload-token", str(raised.exception))

    def test_upload_errors_do_not_echo_one_time_upload_details(self):
        error = HttpTransport._http_error(
            400,
            {},
            b"single-use-upload-token",
            "https://upload.example.invalid/single-use-upload-token",
        )

        self.assertNotIn("single-use-upload-token", str(error))

    def test_small_runtime_executable_uses_the_direct_upload_endpoint(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            executable = Path(temporary_directory) / "VRCNT.exe"
            executable.write_bytes(b"runtime")
            transport = RecordingTransport()

            analysis_id = VirusTotalClient("test-key", transport=transport).submit_file(
                executable
            )

        self.assertEqual("analysis-VRCNT.exe", analysis_id)
        self.assertEqual([], transport.json_requests)
        self.assertEqual([(DIRECT_UPLOAD_URL, "VRCNT.exe")], transport.uploads)

    def test_large_backend_uses_a_one_time_upload_url(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            backend = Path(temporary_directory) / "VRCNT-backend.exe"
            backend.write_bytes(b"backend")
            transport = RecordingTransport()
            client = VirusTotalClient("test-key", transport=transport)

            with mock.patch.object(
                Path,
                "stat",
                return_value=type("Stat", (), {"st_size": DIRECT_UPLOAD_LIMIT_BYTES + 1})(),
            ):
                analysis_id = client.submit_file(backend)

        self.assertEqual("analysis-VRCNT-backend.exe", analysis_id)
        self.assertEqual([("GET", LARGE_UPLOAD_URL)], transport.json_requests)
        self.assertEqual(
            [("https://upload.example.invalid/one-time", "VRCNT-backend.exe")],
            transport.uploads,
        )

    def test_analysis_polling_waits_for_completion_and_returns_engine_stats(self):
        class AnalysisTransport:
            def __init__(self):
                self.requests = []
                self.responses = [
                    {"data": {"attributes": {"status": "queued"}}},
                    {
                        "data": {
                            "attributes": {
                                "status": "completed",
                                "stats": {
                                    "malicious": 0,
                                    "suspicious": 0,
                                    "undetected": 21,
                                },
                            }
                        }
                    },
                ]

            def request_json(self, method, url):
                self.requests.append((method, url))
                return self.responses.pop(0)

        transport = AnalysisTransport()
        delays = []
        client = VirusTotalClient(
            "test-key",
            transport=transport,
            sleep=delays.append,
            clock=lambda: 0,
        )

        stats = client.wait_for_completion(
            "analysis/with-slash", poll_interval_seconds=5, timeout_seconds=30
        )

        self.assertEqual({"malicious": 0, "suspicious": 0, "undetected": 21}, stats)
        self.assertEqual([5], delays)
        self.assertEqual(
            [
                ("GET", "https://www.virustotal.com/api/v3/analyses/analysis%2Fwith-slash"),
                ("GET", "https://www.virustotal.com/api/v3/analyses/analysis%2Fwith-slash"),
            ],
            transport.requests,
        )


class VirusTotalReportTests(unittest.TestCase):
    def test_completed_report_aggregates_detections_and_links_each_executable(self):
        results = [
            ScanResult(
                name="VRCNT.exe",
                sha256="a" * 64,
                size=27_325_440,
                analysis_id="analysis-app",
                stats={"malicious": 0, "suspicious": 0, "undetected": 19},
            ),
            ScanResult(
                name="VRCNT-backend.exe",
                sha256="b" * 64,
                size=56_696_924,
                analysis_id="analysis-backend",
                stats={"malicious": 1, "suspicious": 2, "undetected": 17},
            ),
        ]

        report = build_report("5.12.0", results, generated_at="2026-08-23T12:00:00Z")

        self.assertEqual("completed", report["status"])
        self.assertEqual(
            {"malicious": 1, "suspicious": 2, "engines": 39}, report["summary"]
        )
        self.assertEqual(
            "https://www.virustotal.com/gui/file/" + "a" * 64,
            report["files"][0]["url"],
        )
        self.assertEqual("VRCNT-backend.exe", report["files"][1]["name"])

        with tempfile.TemporaryDirectory() as temporary_directory:
            output_directory = Path(temporary_directory)
            write_report_artifacts(output_directory, report)
            written_report = json.loads(
                (output_directory / REPORT_FILENAME).read_text(encoding="utf-8")
            )
            badge = (output_directory / BADGE_FILENAME).read_text(encoding="utf-8")

            self.assertEqual(report, written_report)
            self.assertIn("1 malicious, 2 suspicious", badge)

    def test_writes_per_file_badges_and_updates_readme_links(self):
        results = [
            ScanResult(
                name="VRCNT.exe",
                sha256="a" * 64,
                size=10,
                analysis_id="analysis-app",
                stats={"malicious": 1, "suspicious": 0, "undetected": 70, "type-unsupported": 4},
            ),
            ScanResult(
                name="VRCNT-backend.exe",
                sha256="b" * 64,
                size=20,
                analysis_id="analysis-backend",
                stats={"malicious": 0, "suspicious": 1, "undetected": 70, "type-unsupported": 4},
            ),
        ]
        report = build_report("5.13.0", results, generated_at="2026-08-23T12:00:00Z")

        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            readme = root / "README.md"
            readme.write_text(
                '<a data-virustotal-file="VRCNT.exe" href="old-app">app</a>\n'
                '<a data-virustotal-file="VRCNT-backend.exe" href="old-backend">backend</a>\n',
                encoding="utf-8",
            )

            update_readme_artifacts(report, root, [readme])

            content = readme.read_text(encoding="utf-8")
            self.assertIn("https://www.virustotal.com/gui/file/" + "a" * 64, content)
            self.assertIn("https://www.virustotal.com/gui/file/" + "b" * 64, content)
            self.assertNotIn('href="old-app"', content)
            self.assertNotIn('href="old-backend"', content)
            app_badge = (root / "Readme" / FILE_BADGE_FILENAMES["VRCNT.exe"]).read_text(
                encoding="utf-8"
            )
            backend_badge = (
                root / "Readme" / FILE_BADGE_FILENAMES["VRCNT-backend.exe"]
            ).read_text(encoding="utf-8")

        self.assertIn("1 flagged / 75 engines", app_badge)
        self.assertIn("1 flagged / 75 engines", backend_badge)

    def test_missing_key_fails_without_publishing_an_unscanned_status(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            executable = root / "VRCNT.exe"
            backend = root / "VRCNT-backend.exe"
            output_directory = root / "release-assets"
            executable.write_bytes(b"app")
            backend.write_bytes(b"backend")

            exit_code = run(
                [
                    "scan",
                    "--version",
                    "5.12.0",
                    "--output-dir",
                    str(output_directory),
                    "--file",
                    str(executable),
                    "--file",
                    str(backend),
                ],
                environment={},
            )
        self.assertEqual(2, exit_code)
        self.assertFalse((output_directory / REPORT_FILENAME).exists())
        self.assertFalse((output_directory / BADGE_FILENAME).exists())


if __name__ == "__main__":
    unittest.main()
