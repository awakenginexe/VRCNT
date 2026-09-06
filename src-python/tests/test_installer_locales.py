import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
GENERATOR = ROOT / "scripts" / "generate_installer_locales.py"
EXPECTED_LANGUAGES = [
    ("en", "English"),
    ("ja", "日本語"),
    ("ko", "한국어"),
    ("th", "ไทย"),
    ("zh-Hant", "繁體中文"),
    ("zh-Hans", "简体中文"),
]
EXPECTED_INSTALLER_KEYS = {
    "app_name",
    "welcome_title",
    "welcome_body",
    "continue",
    "back",
    "language_title",
    "language_body",
    "runtime_title",
    "runtime_body",
    "cpu_title",
    "cpu_body",
    "cpu_size",
    "cpu_time",
    "cuda_title",
    "cuda_body",
    "cuda_size",
    "cuda_time",
    "recommended",
    "compatible",
    "cuda_requires_nvidia",
    "cuda_advisory_inconclusive",
    "gpu_detection_nvidia",
    "gpu_detection_no_nvidia",
    "gpu_detection_inconclusive",
    "cuda_advanced_warning",
    "cuda_advanced_override",
    "install_size",
    "install_time",
    "options_title",
    "options_body",
    "install",
    "progress_title",
    "progress_body",
    "error_title",
    "error_body",
    "retry",
    "complete_title",
    "complete_body",
    "launch_vrcnt",
    "close",
}


def _generate(output_path: Path, locales_path: Path = ROOT / "locales", **consumer_paths: Path) -> subprocess.CompletedProcess[str]:
    consumer_arguments = [argument for name, path in consumer_paths.items() for argument in (f"--{name.replace('_', '-')}", str(path))]
    return subprocess.run(
        [
            sys.executable,
            str(GENERATOR),
            "--locales-dir",
            str(locales_path),
            "--output",
            str(output_path),
            *consumer_arguments,
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )


def test_generator_creates_complete_embedded_catalog_for_the_supported_application_languages(tmp_path):
    output_path = tmp_path / "InstallerLocales.json"

    result = _generate(output_path)

    assert result.returncode == 0, result.stderr
    catalog = json.loads(output_path.read_text(encoding="utf-8"))
    assert [(item["id"], item["name"]) for item in catalog["languages"]] == EXPECTED_LANGUAGES
    assert set(catalog["translations"]) == {language_id for language_id, _ in EXPECTED_LANGUAGES}
    for language_id, _ in EXPECTED_LANGUAGES:
        assert set(catalog["translations"][language_id]) == EXPECTED_INSTALLER_KEYS
        assert all(catalog["translations"][language_id].values())


def test_generator_rejects_a_locale_without_a_complete_installer_namespace(tmp_path):
    source_locales = ROOT / "locales"
    copied_locales = tmp_path / "locales"
    copied_locales.mkdir()
    for source in source_locales.glob("*.yml"):
        target = copied_locales / source.name
        target.write_text(source.read_text(encoding="utf-8"), encoding="utf-8")
    (copied_locales / "languages.json").write_text(
        (source_locales / "languages.json").read_text(encoding="utf-8"),
        encoding="utf-8",
    )
    broken_locale = copied_locales / "th.yml"
    broken_locale.write_text(
        broken_locale.read_text(encoding="utf-8").replace("    close:", "    removed_close:"),
        encoding="utf-8",
    )

    result = _generate(tmp_path / "InstallerLocales.json", copied_locales)

    assert result.returncode != 0
    assert "installer" in result.stderr.lower()


def test_generator_rejects_language_consumer_drift(tmp_path):
    drifted_python_config = tmp_path / "config.py"
    drifted_python_config.write_text(
        (ROOT / "src-python" / "config.py").read_text(encoding="utf-8").replace('"zh-Hans"]', '"fr"]', 1),
        encoding="utf-8",
    )

    result = _generate(tmp_path / "InstallerLocales.json", python_config=drifted_python_config)

    assert result.returncode != 0
    assert "differ" in result.stderr.lower()
