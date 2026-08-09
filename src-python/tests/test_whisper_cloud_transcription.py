import os
import sys
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch


SRC_PYTHON = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if SRC_PYTHON not in sys.path:
    sys.path.insert(0, SRC_PYTHON)

from models.pipeline.latest_queue import LatestQueue
from models.pipeline.pipeline_types import AudioChunk, PipelineSource
from models.transcription.transcription_profile import (
    effective_transcription_profile,
    make_transcription_profile,
    normalize_transcription_profile,
)
from models.transcription.transcription_whisper_cloud import (
    DEFAULT_WHISPER_CLOUD_MODEL,
    GROQ_TRANSCRIPTION_ENDPOINT,
    WHISPER_CLOUD_MODELS,
    WhisperCloudClient,
    WhisperCloudRequestError,
    resolve_whisper_cloud_api_key,
)
from models.transcription.transcription_transcriber import AudioTranscriber
from errors import ErrorCode


CPU = {
    "device": "cpu",
    "device_index": 0,
    "device_name": "CPU",
    "compute_types": ["auto", "int8", "float32"],
}


class FakeResponse:
    def __init__(self, payload, status_code=200, headers=None):
        self._payload = payload
        self.status_code = status_code
        self.headers = headers or {}

    def json(self):
        return self._payload

    def raise_for_status(self):
        return None


class FakeSource:
    SAMPLE_RATE = 16000
    SAMPLE_WIDTH = 2
    channels = 1


class FakeCloudClient:
    def __init__(self):
        self.calls = []

    def transcribe(self, wav_bytes, language=None):
        self.calls.append((wav_bytes, language))
        return {
            "text": f"hello cloud {len(self.calls)}",
            "language": "en",
            "language_probability": 0.91,
        }


def make_profile(engine="Google", cloud_model=DEFAULT_WHISPER_CLOUD_MODEL):
    return make_transcription_profile(
        engine=engine,
        models={
            "Whisper": "tiny",
            "Whisper Thai": "thai-thonburian-small",
            "Vosk": "vosk-en",
            "Parakeet": "parakeet",
            "SenseVoice": "sensevoice",
            "Whisper Cloud": cloud_model,
        },
        device=CPU,
        compute_type="auto",
        whisper_decoding_profile="balanced",
    )


class WhisperCloudClientTests(unittest.TestCase):
    def test_split_key_validation_has_a_dedicated_error_path(self):
        import controller as controller_module

        controller = controller_module.Controller.__new__(controller_module.Controller)
        response = controller.setGroqWhisperAuthKey("not-a-groq-key")

        self.assertEqual(response["status"], 400)
        self.assertEqual(
            response["result"]["error_code"],
            ErrorCode.AUTH_GROQ_WHISPER_INVALID.value,
        )

    def test_config_persists_split_credential_switch_and_cloud_model(self):
        import config as config_module

        self.assertIn("Groq_API", config_module.config.AUTH_KEYS)
        self.assertIn("Groq_Whisper_API", config_module.config.AUTH_KEYS)
        self.assertFalse(config_module.config.USE_SPLIT_GROQ_API_KEY)
        self.assertIn(
            config_module.config.SELECTED_WHISPER_CLOUD_MODEL,
            config_module.config.SELECTABLE_WHISPER_CLOUD_MODEL_LIST,
        )

    def test_supported_models_and_default_are_explicit(self):
        self.assertEqual(
            WHISPER_CLOUD_MODELS,
            ("whisper-large-v3", "whisper-large-v3-turbo"),
        )
        self.assertEqual(DEFAULT_WHISPER_CLOUD_MODEL, "whisper-large-v3-turbo")

    def test_split_key_resolution_does_not_reuse_translation_key(self):
        auth_keys = {
            "Groq_API": "translation-key",
            "Groq_Whisper_API": "transcription-key",
        }

        self.assertEqual(
            resolve_whisper_cloud_api_key(auth_keys, use_split_key=False),
            "translation-key",
        )
        self.assertEqual(
            resolve_whisper_cloud_api_key(auth_keys, use_split_key=True),
            "transcription-key",
        )
        self.assertIsNone(
            resolve_whisper_cloud_api_key(
                {"Groq_API": "translation-key", "Groq_Whisper_API": None},
                use_split_key=True,
            )
        )

    def test_transcription_request_uses_groq_audio_endpoint_and_verbose_json(self):
        calls = []

        def request_post(url, **kwargs):
            calls.append((url, kwargs))
            return FakeResponse({
                "text": "hello",
                "language": "en",
                "language_probability": 0.88,
            })

        client = WhisperCloudClient(
            api_key="gsk-transcription-key",
            model="whisper-large-v3-turbo",
            request_post=request_post,
        )

        payload = client.transcribe(b"wav-bytes", language="en")

        self.assertEqual(payload["text"], "hello")
        self.assertEqual(calls[0][0], GROQ_TRANSCRIPTION_ENDPOINT)
        self.assertEqual(
            calls[0][1]["headers"],
            {"Authorization": "Bearer gsk-transcription-key"},
        )
        self.assertEqual(calls[0][1]["data"], {
            "model": "whisper-large-v3-turbo",
            "language": "en",
            "response_format": "verbose_json",
            "temperature": "0",
        })
        self.assertEqual(calls[0][1]["files"]["file"][0], "audio.wav")

    def test_rate_limit_error_preserves_retry_after_header(self):
        def request_post(url, **kwargs):
            return FakeResponse({}, status_code=429, headers={"Retry-After": "7"})

        client = WhisperCloudClient(
            api_key="gsk-transcription-key",
            request_post=request_post,
        )

        with self.assertRaises(WhisperCloudRequestError) as raised:
            client.transcribe(b"wav-bytes")

        self.assertEqual(raised.exception.status_code, 429)
        self.assertEqual(raised.exception.retry_after, "7")


class WhisperCloudProfileTests(unittest.TestCase):
    def test_cloud_engine_and_model_survive_profile_normalization(self):
        source = make_profile("Whisper Cloud", "whisper-large-v3")
        normalized = normalize_transcription_profile(
            source,
            fallback=source,
            selectable_engines=("Google", "Whisper", "Whisper Cloud"),
            selectable_models={"Whisper Cloud": WHISPER_CLOUD_MODELS},
            selectable_devices=(CPU,),
        )

        self.assertEqual(normalized["engine"], "Whisper Cloud")
        self.assertEqual(
            normalized["models"]["Whisper Cloud"],
            "whisper-large-v3",
        )
        self.assertEqual(
            effective_transcription_profile(normalized),
            ("Whisper Cloud", "whisper-large-v3"),
        )


class WhisperCloudPhraseTests(unittest.TestCase):
    def test_cloud_waits_for_silence_then_submits_one_final_phrase(self):
        client = FakeCloudClient()
        transcriber = AudioTranscriber(
            speaker=False,
            source=FakeSource(),
            phrase_timeout=3,
            max_phrases=10,
            transcription_engine="Whisper Cloud",
            whisper_cloud_model="whisper-large-v3-turbo",
            groq_api_key="gsk-transcription-key",
            whisper_cloud_client=client,
            pipeline_context=None,
        )
        audio_queue = LatestQueue(maxsize=4)
        audio_queue.offer(AudioChunk(
            data=(100).to_bytes(2, "little", signed=True) * 160,
            spoken_at=datetime.now(timezone.utc),
            captured_at_monotonic=0.0,
        ))

        with patch.object(transcriber_module_time(), "monotonic", return_value=0.0):
            self.assertFalse(
                transcriber.transcribeAudioQueue(
                    audio_queue,
                    ["English"],
                    ["United States"],
                )
            )
        self.assertEqual(client.calls, [])

        empty_queue = LatestQueue(maxsize=4)
        with patch.object(transcriber_module_time(), "monotonic", return_value=4.0):
            self.assertTrue(
                transcriber.transcribeAudioQueue(
                    empty_queue,
                    ["English"],
                    ["United States"],
                )
            )

        self.assertEqual(len(client.calls), 1)
        self.assertEqual(client.calls[0][1], "en")
        self.assertEqual(transcriber.getTranscript()["text"], "hello cloud 1")

    def test_each_silent_cloud_phrase_starts_a_new_transcript_entry(self):
        client = FakeCloudClient()
        transcriber = AudioTranscriber(
            speaker=False,
            source=FakeSource(),
            phrase_timeout=3,
            max_phrases=10,
            transcription_engine="Whisper Cloud",
            whisper_cloud_model="whisper-large-v3-turbo",
            groq_api_key="gsk-transcription-key",
            whisper_cloud_client=client,
            pipeline_context=None,
        )
        chunk = AudioChunk(
            data=(100).to_bytes(2, "little", signed=True) * 160,
            spoken_at=datetime.now(timezone.utc),
            captured_at_monotonic=0.0,
        )
        audio_queue = LatestQueue(maxsize=4)

        with patch.object(transcriber_module_time(), "monotonic", return_value=0.0):
            audio_queue.offer(chunk)
            transcriber.transcribeAudioQueue(
                audio_queue,
                ["English"],
                ["United States"],
            )
        with patch.object(transcriber_module_time(), "monotonic", return_value=4.0):
            transcriber.transcribeAudioQueue(
                LatestQueue(maxsize=4),
                ["English"],
                ["United States"],
            )

        with patch.object(transcriber_module_time(), "monotonic", return_value=5.0):
            audio_queue.offer(chunk)
            transcriber.transcribeAudioQueue(
                audio_queue,
                ["English"],
                ["United States"],
            )
        with patch.object(transcriber_module_time(), "monotonic", return_value=9.0):
            transcriber.transcribeAudioQueue(
                LatestQueue(maxsize=4),
                ["English"],
                ["United States"],
            )

        self.assertEqual(len(client.calls), 2)
        self.assertEqual([item["text"] for item in transcriber.transcript_data], [
            "hello cloud 2",
            "hello cloud 1",
        ])


def transcriber_module_time():
    import models.transcription.transcription_transcriber as transcriber_module

    return transcriber_module.time


if __name__ == "__main__":
    unittest.main()
