import os
import sys
import unittest
from unittest.mock import Mock, patch


sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import controller as controller_module
import model as model_module
from controller import Controller
from model import Model
from models.pipeline.pipeline_types import (
    LanguageSlotSnapshot,
    MessageFormatSnapshot,
    OutputConfigSnapshot,
    PipelineSource,
    TranscriptionTrace,
    TranslationStatus,
    TranslationTarget,
    TranslationUpdate,
)


def _format_snapshot():
    return MessageFormatSnapshot(
        message_prefix="<m>",
        message_suffix="</m>",
        translation_prefix="<t>",
        translation_suffix="</t>",
        translation_separator=" / ",
        message_translation_separator=" | ",
        translation_first=False,
    )


def _output_snapshot(**overrides):
    values = {
        "selected_tab_no": "1",
        "translation_enabled": True,
        "send_message_to_vrc": True,
        "send_received_message_to_vrc": False,
        "send_only_translated_messages": False,
        "send_original_while_translating": False,
        "overlay_small_log": False,
        "overlay_large_log": False,
        "overlay_show_only_translated_messages": False,
        "enable_clipboard": False,
        "logger_feature": False,
        "convert_message_to_hiragana": False,
        "convert_message_to_romaji": False,
        "websocket_requested": False,
        "your_languages": (
            LanguageSlotSnapshot("1", "Thai", "Thailand", True),
        ),
        "your_translation_languages": (),
        "target_languages": (
            LanguageSlotSnapshot("1", "English", "United States", True),
        ),
        "send_format": _format_snapshot(),
        "received_format": _format_snapshot(),
    }
    values.update(overrides)
    return OutputConfigSnapshot(**values)


def _trace(
    trace_id,
    output_config,
    *,
    source_language="Thai",
    original_message=None,
    targets=None,
):
    if original_message is None:
        original_message = f"spoken-{trace_id}"
    if targets is None:
        targets = (TranslationTarget("1", "English", "United States"),)
    return TranscriptionTrace(
        trace_id=trace_id,
        generation=1,
        source=PipelineSource.MIC,
        original_message=original_message,
        source_language=source_language,
        original_transliteration=(),
        targets=targets,
        providers=("Google",),
        ctranslate2_weight_type="unused",
        context_history=(),
        started_at_monotonic=1.0,
        output_config=output_config,
    )


def _final_task(trace, message, translation_messages=None):
    if translation_messages is None:
        translation_messages = {
            target.target_slot: f"translated-{trace.trace_id}"
            for target in trace.targets
        }
    return controller_module.FinalOutputTask(
        trace_id=trace.trace_id,
        generation=trace.generation,
        source=PipelineSource.MIC,
        original_message=message,
        source_language=trace.source_language,
        original_transliteration=(),
        targets=trace.targets,
        translations=tuple(
            TranslationUpdate(
                trace.trace_id,
                target.target_slot,
                TranslationStatus.SUCCESS,
                "Google",
                translation_messages[target.target_slot],
                (),
                10,
                0,
                None,
            )
            for target in trace.targets
        ),
        output_config=trace.output_config,
        started_at_monotonic=1.0,
    )


class MicOutputAdmissionTests(unittest.TestCase):
    def test_mic_mute_handler_accepts_first_state_even_when_previous_state_unknown(self):
        instance = object.__new__(Model)
        instance._inited = True
        instance.osc_handler = Mock()
        instance.osc_handler.osc_parameter_muteself = "/avatar/parameters/MuteSelf"
        instance.mic_mute_status = None
        instance.changeMicTranscriptStatus = Mock()

        with patch.multiple(
            model_module.config,
            _ENABLE_TRANSCRIPTION_SEND=True,
            _VRC_MIC_MUTE_SYNC=True,
        ):
            instance.startReceiveOSC()
            handler = instance.osc_handler.setDictFilterAndTarget.call_args.args[0][
                "/avatar/parameters/MuteSelf"
            ]
            handler("/avatar/parameters/MuteSelf", True)

        self.assertTrue(instance.mic_mute_status)
        instance.changeMicTranscriptStatus.assert_called_once_with()

    def test_enabling_already_enabled_mic_sync_refreshes_current_osc_mute_state(self):
        fake_model = Mock()
        fake_model.getIsOscQueryEnabled.return_value = True

        with patch.object(controller_module, "model", fake_model), patch.multiple(
            controller_module.config,
            _VRC_MIC_MUTE_SYNC=True,
        ):
            response = Controller.setEnableVrcMicMuteSync()

        self.assertEqual(response, {"status": 200, "result": True})
        fake_model.setMuteSelfStatus.assert_called_once_with()
        fake_model.changeMicTranscriptStatus.assert_called_once_with()

    def test_mic_osc_output_is_blocked_when_mute_sync_reports_muted(self):
        fake_model = Mock()
        fake_model.mic_mute_status = True

        with patch.object(controller_module, "model", fake_model), patch.multiple(
            controller_module.config,
            _VRC_MIC_MUTE_SYNC=True,
        ):
            self.assertFalse(Controller._micOscOutputAllowed())

    def test_original_fallback_is_sent_then_translated_output_is_resent(self):
        controller = Controller()
        controller.run = Mock()
        fake_model = Mock()
        fake_model.isSourcePipelineGenerationCurrent.return_value = True
        fake_model.mic_mute_status = False
        trace = _trace(
            "first",
            _output_snapshot(send_original_while_translating=True),
        )

        with patch.object(controller_module, "model", fake_model), patch.multiple(
            controller_module.config,
            _VRC_MIC_MUTE_SYNC=False,
        ):
            controller._emitInitialTranscriptionTrace(trace)
            controller._finalizeMicOutput(_final_task(trace, trace.original_message))

        self.assertEqual(
            [call.args[0] for call in fake_model.oscSendMessage.call_args_list],
            [
                "<m>spoken-first</m>",
                "<m>spoken-first</m> | <t>translated-first</t>",
            ],
        )

    def test_original_fallback_resends_original_with_three_distinct_translations(self):
        controller = Controller()
        controller.run = Mock()
        fake_model = Mock()
        fake_model.isSourcePipelineGenerationCurrent.return_value = True
        fake_model.mic_mute_status = False
        targets = (
            TranslationTarget("1", "Chinese", "China"),
            TranslationTarget("2", "Thai", "Thailand"),
            TranslationTarget("3", "Japanese", "Japan"),
        )
        trace = _trace(
            "three-targets",
            _output_snapshot(send_original_while_translating=True),
            source_language="English",
            targets=targets,
        )

        with patch.object(controller_module, "model", fake_model), patch.multiple(
            controller_module.config,
            _VRC_MIC_MUTE_SYNC=False,
        ):
            controller._emitInitialTranscriptionTrace(trace)
            controller._finalizeMicOutput(
                _final_task(
                    trace,
                    trace.original_message,
                    {
                        "1": "中文",
                        "2": "ไทย",
                        "3": "日本語",
                    },
                )
            )

        self.assertEqual(
            [call.args[0] for call in fake_model.oscSendMessage.call_args_list],
            [
                "<m>spoken-three-targets</m>",
                "<m>spoken-three-targets</m> | <t>中文 / ไทย / 日本語</t>",
            ],
        )

    def test_normal_mic_output_omits_translation_for_source_language_target(self):
        controller = Controller()
        controller.run = Mock()
        fake_model = Mock()
        fake_model.isSourcePipelineGenerationCurrent.return_value = True
        fake_model.mic_mute_status = False
        targets = (
            TranslationTarget("1", "Chinese", "China"),
            TranslationTarget("2", "Thai", "Thailand"),
            TranslationTarget("3", "English", "United States"),
        )
        trace = _trace(
            "source-duplicate",
            _output_snapshot(),
            source_language="English",
            targets=targets,
        )

        with patch.object(controller_module, "model", fake_model), patch.multiple(
            controller_module.config,
            _VRC_MIC_MUTE_SYNC=False,
        ):
            controller._finalizeMicOutput(
                _final_task(
                    trace,
                    trace.original_message,
                    {
                        "1": "中文",
                        "2": "ไทย",
                        "3": "English",
                    },
                )
            )

        self.assertEqual(
            [call.args[0] for call in fake_model.oscSendMessage.call_args_list],
            ["<m>spoken-source-duplicate</m> | <t>中文 / ไทย</t>"],
        )

    def test_final_mic_osc_output_is_blocked_while_mute_sync_reports_muted(self):
        controller = Controller()
        controller.run = Mock()
        fake_model = Mock()
        fake_model.isSourcePipelineGenerationCurrent.return_value = True
        fake_model.mic_mute_status = True
        trace = _trace("muted", _output_snapshot())

        with patch.object(controller_module, "model", fake_model), patch.multiple(
            controller_module.config,
            _VRC_MIC_MUTE_SYNC=True,
        ):
            controller._finalizeMicOutput(_final_task(trace, trace.original_message))

        fake_model.oscSendMessage.assert_not_called()

    def test_new_mic_voice_activity_cancels_pending_translation_resend(self):
        controller = Controller()
        controller.run = Mock()
        fake_model = Mock()
        fake_model.isSourcePipelineGenerationCurrent.return_value = True
        fake_model.mic_mute_status = False
        trace = _trace(
            "voice-active",
            _output_snapshot(send_original_while_translating=True),
        )

        with patch.object(controller_module, "model", fake_model), patch.multiple(
            controller_module.config,
            _VRC_MIC_MUTE_SYNC=False,
        ):
            controller._emitInitialTranscriptionTrace(trace)
            controller._handleMicVoiceActivity(True, 2.0)
            controller._finalizeMicOutput(_final_task(trace, trace.original_message))

        self.assertEqual(
            [call.args[0] for call in fake_model.oscSendMessage.call_args_list],
            ["<m>spoken-voice-active</m>"],
        )

    def test_late_translation_resend_is_cancelled_after_next_mic_trace(self):
        controller = Controller()
        controller.run = Mock()
        fake_model = Mock()
        fake_model.isSourcePipelineGenerationCurrent.return_value = True
        fake_model.mic_mute_status = False
        first = _trace(
            "first",
            _output_snapshot(send_original_while_translating=True),
        )
        second = _trace(
            "second",
            _output_snapshot(send_original_while_translating=True),
        )

        with patch.object(controller_module, "model", fake_model), patch.multiple(
            controller_module.config,
            _VRC_MIC_MUTE_SYNC=False,
        ):
            controller._emitInitialTranscriptionTrace(first)
            controller._emitInitialTranscriptionTrace(second)
            controller._finalizeMicOutput(_final_task(first, first.original_message))

        self.assertEqual(
            [call.args[0] for call in fake_model.oscSendMessage.call_args_list],
            ["<m>spoken-first</m>", "<m>spoken-second</m>"],
        )


if __name__ == "__main__":
    unittest.main()
