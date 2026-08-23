"""Create VirusTotal status artifacts for VRCNT release executables."""

from __future__ import annotations

import argparse
import hashlib
import html
import http.client
import json
import os
import re
import secrets
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Mapping, Sequence


API_BASE_URL = "https://www.virustotal.com/api/v3"
DIRECT_UPLOAD_URL = f"{API_BASE_URL}/files"
LARGE_UPLOAD_URL = f"{API_BASE_URL}/files/upload_url"
ANALYSIS_URL_TEMPLATE = f"{API_BASE_URL}/analyses/{{analysis_id}}"
DIRECT_UPLOAD_LIMIT_BYTES = 32 * 1024 * 1024
MAX_UPLOAD_BYTES = 650_000_000
REPORT_FILENAME = "VirusTotal-report.json"
BADGE_FILENAME = "VirusTotal-status.svg"
FILE_BADGE_FILENAMES = {
    "VRCNT.exe": "VirusTotal-VRCNT.svg",
    "VRCNT-backend.exe": "VirusTotal-backend.svg",
}
DEFAULT_README_FILES = (
    Path("README.md"),
    Path("Readme/Readme.en.md"),
    Path("Readme/Readme.jp.md"),
    Path("Readme/Readme.kr.md"),
    Path("Readme/Readme.scn.md"),
    Path("Readme/Readme.tcn.md"),
    Path("Readme/Readme.th.md"),
)
VIRUSTOTAL_FILE_URL_PATTERN = re.compile(
    r"^https://www\.virustotal\.com/gui/file/[0-9a-f]{64}$"
)
VIRUSTOTAL_LOGO_PATH = (
    "M10.87 12L0 22.68h24V1.32H0zm10.73 8.52H5.28l8.637-8.448L5.28 3.48H21.6z"
)
DEFAULT_POLL_INTERVAL_SECONDS = 30
DEFAULT_TIMEOUT_SECONDS = 30 * 60


class VirusTotalError(RuntimeError):
    """A VirusTotal request or response could not be completed safely."""

    def __init__(self, message: str, *, status_code: int | None = None, retry_after: int | None = None):
        super().__init__(message)
        self.status_code = status_code
        self.retry_after = retry_after


@dataclass(frozen=True)
class ScanResult:
    name: str
    sha256: str
    size: int
    analysis_id: str | None
    stats: Mapping[str, int]


class HttpTransport:
    """Minimal standard-library transport that never logs the API key."""

    def __init__(self, api_key: str):
        self._api_key = api_key

    def request_json(self, method: str, url: str) -> dict:
        request = urllib.request.Request(
            url,
            headers={
                "Accept": "application/json",
                "User-Agent": "VRCNT-release-scanner/1.0",
                "x-apikey": self._api_key,
            },
            method=method,
        )
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                return self._decode_json(response.read(), url)
        except urllib.error.HTTPError as error:
            raise self._http_error(error.code, error.headers, error.read(), url) from error
        except urllib.error.URLError as error:
            raise VirusTotalError(
                f"VirusTotal request failed for {self._safe_request_target(url)}: {error.reason}"
            ) from error

    def upload_file(self, url: str, file_path: Path) -> dict:
        parsed = urllib.parse.urlsplit(url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise VirusTotalError("VirusTotal returned an invalid upload URL.")

        boundary = f"----vrcnt-{secrets.token_hex(16)}"
        filename = file_path.name.replace('"', "")
        prefix = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
            "Content-Type: application/octet-stream\r\n\r\n"
        ).encode("utf-8")
        suffix = f"\r\n--{boundary}--\r\n".encode("ascii")
        content_length = len(prefix) + file_path.stat().st_size + len(suffix)
        target = parsed.path or "/"
        if parsed.query:
            target = f"{target}?{parsed.query}"
        connection_type = http.client.HTTPSConnection if parsed.scheme == "https" else http.client.HTTPConnection
        connection = connection_type(parsed.netloc, timeout=120)

        try:
            connection.putrequest("POST", target)
            connection.putheader("Accept", "application/json")
            connection.putheader("User-Agent", "VRCNT-release-scanner/1.0")
            connection.putheader("x-apikey", self._api_key)
            connection.putheader("Content-Type", f"multipart/form-data; boundary={boundary}")
            connection.putheader("Content-Length", str(content_length))
            connection.endheaders()
            connection.send(prefix)
            with file_path.open("rb") as source:
                while chunk := source.read(1024 * 1024):
                    connection.send(chunk)
            connection.send(suffix)

            response = connection.getresponse()
            payload = response.read()
            if not 200 <= response.status < 300:
                raise self._http_error(response.status, response.headers, payload, url)
            return self._decode_json(payload, url)
        except OSError as error:
            raise VirusTotalError(f"VirusTotal upload failed for {file_path.name}: {error}") from error
        finally:
            connection.close()

    @staticmethod
    def _decode_json(payload: bytes, url: str) -> dict:
        target = HttpTransport._safe_request_target(url)
        try:
            decoded = json.loads(payload.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise VirusTotalError(f"VirusTotal returned invalid JSON for {target}.") from error
        if not isinstance(decoded, dict):
            raise VirusTotalError(f"VirusTotal returned an invalid response for {target}.")
        return decoded

    @staticmethod
    def _safe_request_target(url: str) -> str:
        if url.startswith(f"{API_BASE_URL}/"):
            return url
        return "VirusTotal file upload"

    @staticmethod
    def _http_error(status_code: int, headers, payload: bytes, url: str) -> VirusTotalError:
        retry_after = headers.get("Retry-After") if headers else None
        try:
            retry_after_seconds = int(retry_after) if retry_after else None
        except ValueError:
            retry_after_seconds = None
        target = HttpTransport._safe_request_target(url)
        message = payload.decode("utf-8", errors="replace").strip()
        detail = f": {message}" if message and target != "VirusTotal file upload" else ""
        return VirusTotalError(
            f"VirusTotal returned HTTP {status_code} for {target}{detail}",
            status_code=status_code,
            retry_after=retry_after_seconds,
        )


class VirusTotalClient:
    def __init__(
        self,
        api_key: str,
        *,
        transport=None,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
    ):
        self._transport = transport or HttpTransport(api_key)
        self._sleep = sleep
        self._clock = clock

    def submit_file(self, file_path: Path) -> str:
        size = file_path.stat().st_size
        if size > MAX_UPLOAD_BYTES:
            raise VirusTotalError(
                f"{file_path.name} is {size} bytes, above VirusTotal's {MAX_UPLOAD_BYTES}-byte upload limit."
            )

        if size <= DIRECT_UPLOAD_LIMIT_BYTES:
            response = self._with_retries(
                lambda: self._transport.upload_file(DIRECT_UPLOAD_URL, file_path)
            )
        else:
            upload_url_response = self._with_retries(
                lambda: self._transport.request_json("GET", LARGE_UPLOAD_URL)
            )
            upload_url = upload_url_response.get("data")
            if not isinstance(upload_url, str) or not upload_url:
                raise VirusTotalError("VirusTotal did not provide a usable large-file upload URL.")
            response = self._with_retries(
                lambda: self._transport.upload_file(upload_url, file_path)
            )

        analysis = response.get("data")
        analysis_id = analysis.get("id") if isinstance(analysis, dict) else None
        if not isinstance(analysis_id, str) or not analysis_id:
            raise VirusTotalError(f"VirusTotal did not return an analysis ID for {file_path.name}.")
        return analysis_id

    def wait_for_completion(
        self,
        analysis_id: str,
        *,
        poll_interval_seconds: int = DEFAULT_POLL_INTERVAL_SECONDS,
        timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
    ) -> dict[str, int]:
        deadline = self._clock() + timeout_seconds
        analysis_url = ANALYSIS_URL_TEMPLATE.format(analysis_id=urllib.parse.quote(analysis_id, safe=""))
        while self._clock() < deadline:
            response = self._with_retries(
                lambda: self._transport.request_json("GET", analysis_url)
            )
            data = response.get("data")
            attributes = data.get("attributes") if isinstance(data, dict) else None
            status = attributes.get("status") if isinstance(attributes, dict) else None
            if status == "completed":
                stats = attributes.get("stats", {})
                if not isinstance(stats, dict):
                    raise VirusTotalError(f"VirusTotal returned invalid analysis statistics for {analysis_id}.")
                return {name: int(value) for name, value in stats.items() if isinstance(value, int)}
            if status not in {"queued", "in-progress"}:
                raise VirusTotalError(f"VirusTotal returned an unexpected analysis status: {status!r}.")
            remaining_seconds = deadline - self._clock()
            if remaining_seconds <= 0:
                break
            self._sleep(min(poll_interval_seconds, remaining_seconds))
        raise VirusTotalError(
            f"VirusTotal analysis {analysis_id} did not complete within {timeout_seconds} seconds."
        )

    def _with_retries(self, operation):
        for attempt in range(3):
            try:
                return operation()
            except VirusTotalError as error:
                retryable = error.status_code in {429, 500, 502, 503, 504}
                if not retryable or attempt == 2:
                    raise
                self._sleep(error.retry_after or 30 * (attempt + 1))
        raise AssertionError("Retry loop must either return or raise.")


def sha256_file(file_path: Path) -> str:
    digest = hashlib.sha256()
    with file_path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def describe_files(file_paths: Sequence[Path]) -> list[ScanResult]:
    results = []
    for file_path in file_paths:
        if not file_path.is_file():
            raise FileNotFoundError(f"VirusTotal scan target is missing: {file_path}")
        results.append(
            ScanResult(
                name=file_path.name,
                sha256=sha256_file(file_path),
                size=file_path.stat().st_size,
                analysis_id=None,
                stats={},
            )
        )
    return results


def scan_files(
    file_paths: Sequence[Path],
    client: VirusTotalClient,
    *,
    poll_interval_seconds: int,
    timeout_seconds: int,
) -> list[ScanResult]:
    results = []
    for file_path in file_paths:
        metadata = describe_files([file_path])[0]
        analysis_id = client.submit_file(file_path)
        stats = client.wait_for_completion(
            analysis_id,
            poll_interval_seconds=poll_interval_seconds,
            timeout_seconds=timeout_seconds,
        )
        results.append(
            ScanResult(
                name=metadata.name,
                sha256=metadata.sha256,
                size=metadata.size,
                analysis_id=analysis_id,
                stats=stats,
            )
        )
    return results


def build_report(
    version: str,
    results: Sequence[ScanResult],
    *,
    generated_at: str | None = None,
    status: str = "completed",
    error: str | None = None,
) -> dict:
    summary = {
        "malicious": sum(int(result.stats.get("malicious", 0)) for result in results),
        "suspicious": sum(int(result.stats.get("suspicious", 0)) for result in results),
        "engines": sum(sum(int(count) for count in result.stats.values()) for result in results),
    }
    return {
        "schema": 1,
        "product": "VRCNT",
        "version": version,
        "status": status,
        "generated_at": generated_at
        or datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "summary": summary,
        "files": [
            {
                "name": result.name,
                "sha256": result.sha256,
                "size": result.size,
                "analysis_id": result.analysis_id,
                "stats": dict(result.stats),
                "url": f"https://www.virustotal.com/gui/file/{result.sha256}",
            }
            for result in results
        ],
        **({"error": error} if error else {}),
    }


def badge_message(report: Mapping) -> tuple[str, str]:
    status = report["status"]
    if status == "completed":
        summary = report["summary"]
        malicious = int(summary["malicious"])
        suspicious = int(summary["suspicious"])
        engines = int(summary["engines"])
        if malicious:
            return f"{malicious} malicious, {suspicious} suspicious", "#cf222e"
        if suspicious:
            return f"0 malicious, {suspicious} suspicious", "#bf8700"
        return f"0 detections / {engines} engines", "#1a7f37"
    if status == "not-configured":
        return "not configured", "#6e7781"
    return "scan failed", "#cf222e"


def create_badge_svg(report: Mapping) -> str:
    message, color = badge_message(report)
    return create_status_badge_svg("VirusTotal", message, color)


def file_badge_message(file_report: Mapping, *, status: str = "completed") -> tuple[str, str]:
    if status != "completed":
        return "scan failed", "#cf222e"
    stats = file_report.get("stats", {})
    if not isinstance(stats, Mapping):
        return "scan failed", "#cf222e"
    engines = sum(int(count) for count in stats.values() if isinstance(count, int))
    flagged = int(stats.get("malicious", 0)) + int(stats.get("suspicious", 0))
    if flagged:
        return f"{flagged} flagged / {engines} engines", "#bf8700"
    return f"0 flagged / {engines} engines", "#1a7f37"


def create_file_badge_svg(file_report: Mapping, *, status: str = "completed") -> str:
    name = file_report.get("name")
    if not isinstance(name, str) or not name:
        raise VirusTotalError("VirusTotal report contains a file without a name.")
    message, color = file_badge_message(file_report, status=status)
    return create_status_badge_svg(name, message, color)


def create_status_badge_svg(label: str, message: str, color: str) -> str:
    logo_size = 12
    logo_gap = 4
    label_text_width = 7 * len(label)
    label_group_width = logo_size + logo_gap + label_text_width
    label_width = max(78, label_group_width + 16)
    logo_x = (label_width - label_group_width) / 2
    label_text_x = logo_x + logo_size + logo_gap + label_text_width / 2
    message_width = max(105, 7 * len(message) + 18)
    total_width = label_width + message_width
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{total_width}" height="20" role="img" '
        f'aria-label="{html.escape(label)}: {html.escape(message)}">'
        f'<title>{html.escape(label)}: {html.escape(message)}</title>'
        f'<linearGradient id="a" x2="0" y2="100%"><stop offset="0" stop-opacity=".1" '
        f'stop-color="#fff"/><stop offset="1" stop-opacity=".1"/></linearGradient>'
        f'<clipPath id="r"><rect width="{total_width}" height="20" rx="3" fill="#fff"/></clipPath>'
        f'<g clip-path="url(#r)"><path fill="#555" d="M0 0h{label_width}v20H0z"/>'
        f'<path fill="{color}" d="M{label_width} 0h{message_width}v20H{label_width}z"/>'
        f'<path fill="url(#a)" d="M0 0h{total_width}v20H0z"/></g>'
        f'<g data-virustotal-logo="true" fill="#fff" transform="translate({logo_x:g} 4) scale(.5)">'
        f'<path d="{VIRUSTOTAL_LOGO_PATH}"/></g>'
        f'<g fill="#fff" text-anchor="middle" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11">'
        f'<text x="{label_text_x:g}" y="15" fill="#010101" fill-opacity=".3">{html.escape(label)}</text>'
        f'<text x="{label_text_x:g}" y="14">{html.escape(label)}</text>'
        f'<text x="{label_width + message_width / 2}" y="15" fill="#010101" fill-opacity=".3">{html.escape(message)}</text>'
        f'<text x="{label_width + message_width / 2}" y="14">{html.escape(message)}</text>'
        "</g></svg>\n"
    )


def write_report_artifacts(output_directory: Path, report: Mapping) -> None:
    output_directory.mkdir(parents=True, exist_ok=True)
    (output_directory / REPORT_FILENAME).write_text(
        json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    (output_directory / BADGE_FILENAME).write_text(create_badge_svg(report), encoding="utf-8")
    for file_report in report.get("files", []):
        if not isinstance(file_report, Mapping):
            continue
        badge_name = FILE_BADGE_FILENAMES.get(file_report.get("name"))
        if badge_name:
            (output_directory / badge_name).write_text(
                create_file_badge_svg(file_report, status=report.get("status", "failed")),
                encoding="utf-8",
            )


def update_readme_artifacts(
    report: Mapping,
    repository_root: Path,
    readme_paths: Sequence[Path] | None = None,
) -> None:
    if report.get("status") != "completed":
        raise VirusTotalError("Cannot update README links from an incomplete VirusTotal report.")

    file_reports = {
        file_report.get("name"): file_report
        for file_report in report.get("files", [])
        if isinstance(file_report, Mapping)
    }
    missing_files = [name for name in FILE_BADGE_FILENAMES if name not in file_reports]
    if missing_files:
        raise VirusTotalError(
            "VirusTotal report is missing README scan targets: " + ", ".join(missing_files)
        )

    badge_directory = repository_root / "Readme"
    badge_directory.mkdir(parents=True, exist_ok=True)
    file_urls = {}
    for name, badge_name in FILE_BADGE_FILENAMES.items():
        file_report = file_reports[name]
        sha256 = file_report.get("sha256")
        url = file_report.get("url")
        expected_url = f"https://www.virustotal.com/gui/file/{sha256}"
        if not isinstance(sha256, str) or not re.fullmatch(r"[0-9a-f]{64}", sha256):
            raise VirusTotalError(f"VirusTotal report has an invalid SHA-256 for {name}.")
        if url != expected_url or not VIRUSTOTAL_FILE_URL_PATTERN.fullmatch(url):
            raise VirusTotalError(f"VirusTotal report has an invalid scan URL for {name}.")
        file_urls[name] = url
        (badge_directory / badge_name).write_text(
            create_file_badge_svg(file_report, status=report["status"]), encoding="utf-8"
        )

    paths = readme_paths or DEFAULT_README_FILES
    for readme_path in paths:
        path = readme_path if readme_path.is_absolute() else repository_root / readme_path
        content = path.read_text(encoding="utf-8")
        found = set()

        def replace_anchor(match: re.Match[str]) -> str:
            anchor = match.group(0)
            for name, url in file_urls.items():
                marker = f'data-virustotal-file="{name}"'
                if marker not in anchor:
                    continue
                if not re.search(r'\bhref="[^"]*"', anchor, flags=re.IGNORECASE):
                    raise VirusTotalError(f"README anchor for {name} has no href in {path}.")
                found.add(name)
                return re.sub(
                    r'\bhref="[^"]*"',
                    f'href="{url}"',
                    anchor,
                    count=1,
                    flags=re.IGNORECASE,
                )
            return anchor

        updated = re.sub(r"<a\b[^>]*>", replace_anchor, content, flags=re.IGNORECASE)
        missing_anchors = [name for name in file_urls if name not in found]
        if missing_anchors:
            raise VirusTotalError(
                f"README {path} is missing VirusTotal anchors for: {', '.join(missing_anchors)}"
            )
        path.write_text(updated, encoding="utf-8")


def parse_arguments(arguments: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    scan_parser = subparsers.add_parser("scan", help="scan release executables and create status artifacts")
    scan_parser.add_argument("--version", required=True)
    scan_parser.add_argument("--output-dir", type=Path, required=True)
    scan_parser.add_argument("--file", type=Path, action="append", required=True)
    scan_parser.add_argument("--poll-interval-seconds", type=int, default=DEFAULT_POLL_INTERVAL_SECONDS)
    scan_parser.add_argument("--timeout-seconds", type=int, default=DEFAULT_TIMEOUT_SECONDS)
    update_parser = subparsers.add_parser(
        "update-readme", help="update per-file VirusTotal badges and README scan links"
    )
    update_parser.add_argument("--report", type=Path, required=True)
    update_parser.add_argument("--repository-root", type=Path, default=Path("."))
    update_parser.add_argument("--readme", type=Path, action="append")
    return parser.parse_args(arguments)


def run(arguments: Sequence[str] | None = None, *, environment: Mapping[str, str] | None = None) -> int:
    args = parse_arguments(arguments if arguments is not None else sys.argv[1:])
    if args.command == "update-readme":
        report = json.loads(args.report.read_text(encoding="utf-8"))
        update_readme_artifacts(report, args.repository_root, args.readme)
        return 0

    file_paths = list(args.file)
    metadata = describe_files(file_paths)
    api_key = (environment if environment is not None else os.environ).get("VIRUSTOTAL_API_KEY", "").strip()
    if not api_key:
        print("VirusTotal API key is not configured.", file=sys.stderr)
        return 2

    try:
        results = scan_files(
            file_paths,
            VirusTotalClient(api_key),
            poll_interval_seconds=args.poll_interval_seconds,
            timeout_seconds=args.timeout_seconds,
        )
    except (OSError, VirusTotalError) as error:
        report = build_report(args.version, metadata, status="failed", error=str(error))
        write_report_artifacts(args.output_dir, report)
        print(f"VirusTotal scan failed: {error}", file=sys.stderr)
        return 1

    report = build_report(args.version, results)
    write_report_artifacts(args.output_dir, report)
    print(
        "VirusTotal scan completed: "
        f"{report['summary']['malicious']} malicious, "
        f"{report['summary']['suspicious']} suspicious."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(run())
