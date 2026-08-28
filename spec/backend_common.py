from pathlib import Path


COMMON_HIDDEN_IMPORTS = [
    "ctranslate2",
    "translators",
    "models.translation.translation_plamo",
    "models.translation.translation_gemini",
    "models.translation.translation_openai",
    "models.translation.translation_deepseek",
    "models.translation.translation_groq",
    "models.translation.translation_openrouter",
    "models.translation.translation_lmstudio",
    "models.translation.translation_ollama",
]

VARIANT_HIDDEN_IMPORTS = {
    "cpu": [
        "torch",
        "sherpa_onnx",
        "vosk",
        "onnx_asr",
        "onnxruntime",
        "onnxruntime.capi._pybind_state",
    ],
    "cuda": [
        "torch",
        "torch.cuda",
        "torch.backends.cuda",
        "sherpa_onnx",
        "vosk",
        "onnx_asr",
        "onnxruntime",
        "onnxruntime.capi._pybind_state",
    ],
}

ENVIRONMENT_DATA_PACKAGES = (
    ("zeroconf", "zeroconf/"),
    ("openvr", "openvr/"),
    ("faster_whisper", "faster_whisper/"),
    ("hf_xet", "hf_xet/"),
    ("sherpa_onnx", "sherpa_onnx/"),
    ("vosk", "vosk/"),
    ("onnx_asr", "onnx_asr/"),
    ("onnxruntime", "onnxruntime/"),
)


def backend_analysis_configuration(variant, repo_root, environment_root):
    if variant not in VARIANT_HIDDEN_IMPORTS:
        raise ValueError(f"unsupported backend variant: {variant}")
    repo_root = Path(repo_root).resolve()
    environment_root = Path(environment_root).resolve()
    site_packages = environment_root / "Lib" / "site-packages"
    environment_datas = [
        (str(site_packages / package), destination)
        for package, destination in ENVIRONMENT_DATA_PACKAGES
    ]
    return {
        "variant": variant,
        "entrypoint": str(repo_root / "src-python" / "mainloop.py"),
        "pathex": [str(repo_root / "src-python")],
        "environment_datas": environment_datas,
        "project_datas": [
            (str(repo_root / "src-python" / "models" / "overlay" / "fonts"), "fonts/"),
            (
                str(repo_root / "src-python" / "models" / "translation" / "translation_settings" / "prompt"),
                "translation_settings/prompt/",
            ),
            (
                str(repo_root / "src-python" / "models" / "translation" / "translation_settings" / "languages"),
                "translation_settings/languages/",
            ),
        ],
        "hiddenimports": COMMON_HIDDEN_IMPORTS + VARIANT_HIDDEN_IMPORTS[variant],
    }


def create_backend_analysis(
    analysis_factory, variant, repo_root, environment_root, required_hiddenimports=()
):
    from PyInstaller.utils.hooks import collect_data_files, collect_submodules, copy_metadata

    config = backend_analysis_configuration(variant, repo_root, environment_root)
    missing = set(required_hiddenimports).difference(config["hiddenimports"])
    if missing:
        raise ValueError(f"missing required hidden imports for {variant}: {sorted(missing)}")
    return analysis_factory(
        [config["entrypoint"]],
        pathex=config["pathex"],
        binaries=[],
        datas=[
            *config["project_datas"],
            *config["environment_datas"],
            *collect_data_files("translators"),
            *copy_metadata("sherpa-onnx"),
            *copy_metadata("onnx-asr"),
            *copy_metadata("translators"),
        ],
        hiddenimports=[*config["hiddenimports"], *collect_submodules("translators")],
        hookspath=[],
        hooksconfig={},
        runtime_hooks=[],
        excludes=["pandas", "matplotlib", "PyQt5"],
        module_collection_mode={"transformers.models": "py"},
        noarchive=False,
        optimize=0,
    )
