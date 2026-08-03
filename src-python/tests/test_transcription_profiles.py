import os
import sys
import unittest
from copy import deepcopy
from unittest.mock import Mock, patch


SRC_PYTHON = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if SRC_PYTHON not in sys.path:
    sys.path.insert(0, SRC_PYTHON)

import controller as controller_module
import model as model_module
from controller import Controller
from model import Model
from models.pipeline.pipeline_types import PipelineSource
from models.transcription.whisper_runtime import WhisperRuntimeManager


CPU = {
    "device": "cpu",
    "device_index": 0,
    "device_name": "CPU",
    "compute_types": ["auto", "int8", "float32"],
}


def profile(engine="Google", whisper="tiny", decoding="balanced"):
    return {
        "engine": engine,
        "models": {
            "Whisper": whisper,
            "Vosk": next(iter(controller_module.config.SELECTABLE_VOSK_WEIGHT_TYPE_LIST), ""),
            "Parakeet": next(iter(controller_module.config.SELECTABLE_PARAKEET_WEIGHT_TYPE_LIST), ""),
            "SenseVoice": next(iter(controller_module.config.SELECTABLE_SENSEVOICE_WEIGHT_TYPE_LIST), ""),
        },
        "device": deepcopy(CPU),
        "compute_type": "auto",
        "whisper_decoding_profile": decoding,
    }


class TranscriptionProfileControllerTests(unittest.TestCase):
    def setUp(self):
        self.original_send = deepcopy(getattr(controller_module.config, "_TRANSCRIPTION_PROFILE_SEND", None))
        self.original_receive = deepcopy(getattr(controller_module.config, "_TRANSCRIPTION_PROFILE_RECEIVE", None))
        controller_module.config._TRANSCRIPTION_PROFILE_SEND = profile()
        controller_module.config._TRANSCRIPTION_PROFILE_RECEIVE = profile()
        self.controller = Controller()
        self.controller._requestTranscriptionSourcesRestartLocked = Mock(return_value=True)

    def tearDown(self):
        self.controller.shutdown()
        if self.original_send is None:
            controller_module.config.__dict__.pop("_TRANSCRIPTION_PROFILE_SEND", None)
        else:
            controller_module.config._TRANSCRIPTION_PROFILE_SEND = self.original_send
        if self.original_receive is None:
            controller_module.config.__dict__.pop("_TRANSCRIPTION_PROFILE_RECEIVE", None)
        else:
            controller_module.config._TRANSCRIPTION_PROFILE_RECEIVE = self.original_receive

    def test_direction_patch_changes_and_restarts_only_that_source(self):
        response = self.controller.setTranscriptionProfileSend({"engine": "Whisper"})

        self.assertEqual(response["status"], 200)
        self.assertEqual(response["result"]["engine"], "Whisper")
        self.assertEqual(controller_module.config.TRANSCRIPTION_PROFILE_RECEIVE["engine"], "Google")
        self.controller._requestTranscriptionSourcesRestartLocked.assert_called_once_with(
            (PipelineSource.MIC,)
        )

    def test_effective_no_op_does_not_restart_or_reload(self):
        response = self.controller.setTranscriptionProfileSend({"engine": "Google"})

        self.assertEqual(response["status"], 200)
        self.controller._requestTranscriptionSourcesRestartLocked.assert_not_called()

    def test_inactive_provider_model_change_persists_without_runtime_restart(self):
        response = self.controller.setTranscriptionProfileSend(
            {"models": {"Whisper": "base"}}
        )

        self.assertEqual(response["result"]["models"]["Whisper"], "base")
        self.controller._requestTranscriptionSourcesRestartLocked.assert_not_called()

    def test_apply_to_both_is_atomic_and_restarts_only_changed_sources_once(self):
        controller_module.config._TRANSCRIPTION_PROFILE_SEND = profile("Google")
        controller_module.config._TRANSCRIPTION_PROFILE_RECEIVE = profile("Whisper")

        response = self.controller.setTranscriptionProfileAll(profile("Google"))

        self.assertEqual(response["status"], 200)
        self.assertEqual(
            controller_module.config.TRANSCRIPTION_PROFILE_SEND,
            controller_module.config.TRANSCRIPTION_PROFILE_RECEIVE,
        )
        self.controller._requestTranscriptionSourcesRestartLocked.assert_called_once_with(
            (PipelineSource.SPEAKER,)
        )

    def test_apply_to_both_publishes_only_after_both_profiles_commit(self):
        controller_module.config._TRANSCRIPTION_PROFILE_SEND = profile("Google")
        controller_module.config._TRANSCRIPTION_PROFILE_RECEIVE = profile("Whisper")
        observed = []
        self.controller._publishSourceTranscriptionProfile = lambda source: observed.append(
            (
                source,
                deepcopy(controller_module.config.TRANSCRIPTION_PROFILE_SEND),
                deepcopy(controller_module.config.TRANSCRIPTION_PROFILE_RECEIVE),
            )
        )

        self.controller.setTranscriptionProfileAll(profile("SenseVoice"))

        self.assertEqual(len(observed), 2)
        for _source, outgoing, incoming in observed:
            self.assertEqual(outgoing, incoming)
            self.assertEqual(outgoing["engine"], "SenseVoice")

    def test_apply_to_both_when_profiles_already_match_is_no_op(self):
        candidate = profile("Whisper", whisper="tiny")
        target = self.controller._normalizeTranscriptionProfile(candidate, candidate)
        controller_module.config._TRANSCRIPTION_PROFILE_SEND = deepcopy(target)
        controller_module.config._TRANSCRIPTION_PROFILE_RECEIVE = deepcopy(target)

        self.controller._syncLegacyTranscriptionSettingsFromSend = Mock()
        response = self.controller.setTranscriptionProfileAll(deepcopy(target))

        self.assertEqual(response["status"], 200)
        self.controller._requestTranscriptionSourcesRestartLocked.assert_not_called()
        self.controller._syncLegacyTranscriptionSettingsFromSend.assert_not_called()

    def test_legacy_engine_setter_copies_the_complete_compatibility_profile_once(self):
        controller_module.config._TRANSCRIPTION_PROFILE_SEND = profile("Google", whisper="tiny")
        controller_module.config._TRANSCRIPTION_PROFILE_RECEIVE = profile("Whisper", whisper="small")

        response = self.controller.setSelectedTranscriptionEngine("SenseVoice")

        self.assertEqual(response, {"status": 200, "result": "SenseVoice"})
        self.assertEqual(
            controller_module.config.TRANSCRIPTION_PROFILE_SEND,
            controller_module.config.TRANSCRIPTION_PROFILE_RECEIVE,
        )
        self.assertEqual(controller_module.config.TRANSCRIPTION_PROFILE_SEND["engine"], "SenseVoice")
        self.controller._requestTranscriptionSourcesRestartLocked.assert_called_once_with(
            (PipelineSource.MIC, PipelineSource.SPEAKER)
        )

    def test_atomic_restart_creates_one_replacement_session_per_affected_source(self):
        events = []
        self.controller._requestTranscriptionSourcesRestartLocked = (
            Controller._requestTranscriptionSourcesRestartLocked.__get__(self.controller)
        )
        self.controller.stopTranscriptionSendMessage = lambda: events.append("stop-send")
        self.controller.stopTranscriptionReceiveMessage = lambda: events.append("stop-receive")
        self.controller.startTranscriptionSendMessage = lambda: events.append("start-send") or True
        self.controller.startTranscriptionReceiveMessage = lambda: events.append("start-receive") or True

        with patch.object(
            controller_module.model,
            "isTranscriptionSourceActive",
            return_value=True,
        ):
            result = self.controller._requestTranscriptionSourcesRestartLocked(
                (PipelineSource.MIC, PipelineSource.SPEAKER, PipelineSource.MIC)
            )

        self.assertTrue(result)
        self.assertEqual(
            events,
            ["stop-send", "stop-receive", "start-send", "start-receive"],
        )

    def test_startup_whisper_fallback_updates_both_profile_model_selections(self):
        send = profile("Whisper", whisper="missing-send")
        receive = profile("Whisper", whisper="missing-receive")
        controller_module.config._TRANSCRIPTION_PROFILE_SEND = send
        controller_module.config._TRANSCRIPTION_PROFILE_RECEIVE = receive

        with patch.object(
            controller_module.model,
            "checkTranscriptionWhisperModelWeight",
            side_effect=lambda weight: weight == "tiny",
        ):
            self.controller._fallbackSelectedWhisperWeight("tiny", True)

        self.assertEqual(
            controller_module.config.TRANSCRIPTION_PROFILE_SEND["models"]["Whisper"],
            "tiny",
        )
        self.assertEqual(
            controller_module.config.TRANSCRIPTION_PROFILE_RECEIVE["models"]["Whisper"],
            "tiny",
        )
        self.controller._requestTranscriptionSourcesRestartLocked.assert_not_called()

    def test_model_status_refresh_checks_models_selected_by_both_profiles(self):
        send = profile("Vosk")
        receive = profile("Vosk")
        send["models"]["Vosk"] = "outgoing-vosk"
        receive["models"]["Vosk"] = "incoming-vosk"
        controller_module.config._TRANSCRIPTION_PROFILE_SEND = send
        controller_module.config._TRANSCRIPTION_PROFILE_RECEIVE = receive

        with (
            patch.dict(
                controller_module.config.SELECTABLE_VOSK_WEIGHT_TYPE_DICT,
                {"outgoing-vosk": False, "incoming-vosk": False},
                clear=True,
            ),
            patch.object(
                controller_module.model,
                "checkTranscriptionVoskModelWeight",
                side_effect=lambda weight: weight == "incoming-vosk",
            ) as check,
        ):
            self.controller.updateDownloadedVoskModelWeight()

        self.assertEqual(
            [call.args[0] for call in check.call_args_list],
            ["outgoing-vosk", "incoming-vosk"],
        )

    def test_startup_engine_fallback_updates_profile_source_of_truth(self):
        controller_module.config._TRANSCRIPTION_PROFILE_SEND = profile("Vosk")
        controller_module.config._TRANSCRIPTION_PROFILE_RECEIVE = profile("SenseVoice")

        with patch.dict(
            controller_module.config.SELECTABLE_TRANSCRIPTION_ENGINE_STATUS,
            {"Google": True, "Whisper": False, "Vosk": False, "SenseVoice": False},
            clear=True,
        ):
            self.controller.updateTranscriptionEngine()

        self.assertEqual(controller_module.config.TRANSCRIPTION_PROFILE_SEND["engine"], "Google")
        self.assertEqual(controller_module.config.TRANSCRIPTION_PROFILE_RECEIVE["engine"], "Google")

    def test_resource_monitor_can_follow_incoming_gpu_profile(self):
        send = profile("Google")
        receive = profile("Whisper")
        receive["device"] = {
            "device": "cuda",
            "device_index": 3,
            "device_name": "GPU 3",
            "compute_types": ["auto", "float16"],
        }
        controller_module.config._TRANSCRIPTION_PROFILE_SEND = send
        controller_module.config._TRANSCRIPTION_PROFILE_RECEIVE = receive

        with patch.object(
            controller_module.config,
            "_SELECTED_TRANSLATION_COMPUTE_DEVICE",
            deepcopy(CPU),
        ):
            selected = self.controller._getSelectedResourceMonitorGpuIndex()

        self.assertEqual(selected, 3)


class TranscriptionProfileRuntimeTests(unittest.TestCase):
    def test_matching_whisper_profiles_create_two_leases_with_one_model_load(self):
        instance = object.__new__(Model)
        loads = []
        unloaded = []

        def factory(root, key):
            loads.append((root, key))
            return object()

        instance.whisper_runtime_manager = WhisperRuntimeManager(
            factory=factory,
            unload=unloaded.append,
        )
        matching = profile("Whisper", whisper="tiny")

        with (
            patch.object(model_module.config, "_TRANSCRIPTION_PROFILE_SEND", deepcopy(matching), create=True),
            patch.object(model_module.config, "_TRANSCRIPTION_PROFILE_RECEIVE", deepcopy(matching), create=True),
            patch.object(model_module, "checkWhisperWeight", return_value=True),
        ):
            first = instance._acquireWhisperRuntimeLease(PipelineSource.MIC)
            second = instance._acquireWhisperRuntimeLease(PipelineSource.SPEAKER)

        self.assertIsNot(first, second)
        self.assertEqual(len(loads), 1)
        first.close()
        self.assertEqual(unloaded, [])
        second.close()
        self.assertEqual(len(unloaded), 1)

    def test_source_profile_controls_transcriber_model_and_decoding_context(self):
        instance = object.__new__(Model)
        instance._inited = True
        instance._ensureTranscriptionLifecycleState()
        send = profile("Whisper", whisper="small", decoding="accurate")
        receive = profile("Google", whisper="tiny", decoding="fast")

        with (
            patch.object(model_module.config, "_TRANSCRIPTION_PROFILE_SEND", send, create=True),
            patch.object(model_module.config, "_TRANSCRIPTION_PROFILE_RECEIVE", receive, create=True),
        ):
            send_profile = instance._sourceTranscriptionProfile(PipelineSource.MIC)
            receive_profile = instance._sourceTranscriptionProfile(PipelineSource.SPEAKER)
            context = instance._makeTranscriberPipelineContext(PipelineSource.MIC, None, 1)

        self.assertEqual(send_profile["models"]["Whisper"], "small")
        self.assertEqual(receive_profile["engine"], "Google")
        self.assertEqual(context.whisper_decoding_profile, "accurate")

    def test_mixed_google_and_whisper_profiles_load_only_the_whisper_runtime(self):
        instance = object.__new__(Model)
        loads = []
        instance.whisper_runtime_manager = WhisperRuntimeManager(
            factory=lambda root, key: loads.append((root, key)) or object(),
            unload=lambda _model: None,
        )
        send = profile("Google")
        receive = profile("Whisper", whisper="tiny")

        with (
            patch.object(model_module.config, "_TRANSCRIPTION_PROFILE_SEND", send, create=True),
            patch.object(model_module.config, "_TRANSCRIPTION_PROFILE_RECEIVE", receive, create=True),
            patch.object(model_module, "checkWhisperWeight", return_value=True),
        ):
            mic = instance._acquireWhisperRuntimeLease(PipelineSource.MIC)
            speaker = instance._acquireWhisperRuntimeLease(PipelineSource.SPEAKER)

        self.assertIsNone(mic)
        self.assertIsNotNone(speaker)
        self.assertEqual(len(loads), 1)
        speaker.close()


if __name__ == "__main__":
    unittest.main()
