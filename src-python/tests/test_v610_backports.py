import asyncio
import os
import sys
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from models.transcription import transcription_recorder as recorder
from models.transcription.transcription_transcriber import AudioTranscriber
import numpy as np
import model as model_module


class CaptureBackportTests(unittest.TestCase):
    def test_microphone_recorders_open_native_stereo_channels(self):
        device = {"index": 7, "defaultSampleRate": 48000, "maxInputChannels": 2}
        source = SimpleNamespace()
        with patch.object(recorder, "_create_microphone", return_value=source) as create:
            for cls, args in ((recorder.SelectedMicRecorder, (300, True, 5)),
                              (recorder.SelectedMicEnergyRecorder, ()),
                              (recorder.SelectedMicBingRealtimeRecorder, (300, True)),
                              (recorder.SelectedMicEnergyAndAudioRecorder, (300, True, 10))):
                cls(device, *args)
                self.assertTrue(create.call_args.kwargs["speaker"])
                self.assertEqual(create.call_args.kwargs["channels"], 2)

    def test_stereo_microphone_is_averaged_without_clipping(self):
        pcm = np.array([30000, 30000, -30000, -30000, 1000, 3000], dtype="<i2")
        obj = SimpleNamespace(audio_sources={"last_sample": pcm.tobytes(),
            "sample_rate": 48000, "sample_width": 2, "channels": 2})
        audio = AudioTranscriber.processMicData(obj)
        self.assertEqual(np.frombuffer(audio.frame_data, dtype="<i2").tolist(), [30000, -30000, 2000])

    def test_partial_stereo_frame_is_discarded(self):
        obj = SimpleNamespace(audio_sources={"last_sample": np.array([10, 20, 99], dtype="<i2").tobytes(),
            "sample_rate": 48000, "sample_width": 2, "channels": 2})
        self.assertEqual(AudioTranscriber.processMicData(obj).frame_data, np.array([15], dtype="<i2").tobytes())


class InitializationBackportTests(unittest.TestCase):
    def test_concurrent_initialization_waits_for_first_resource_construction(self):
        entered, release, second_done = threading.Event(), threading.Event(), threading.Event()
        calls = []
        obj = object.__new__(model_module.Model)
        obj._inited = False
        def initialize():
            if obj._inited:
                return
            calls.append(1)
            entered.set()
            release.wait(2)
            obj._inited = True
        with patch.object(model_module.Model, "_initResources", create=True, side_effect=initialize):
            first = threading.Thread(target=obj.init)
            second = threading.Thread(target=lambda: (obj.init(), second_done.set()))
            first.start()
            try:
                self.assertTrue(entered.wait(1))
                second.start()
                self.assertFalse(second_done.wait(0.05))
            finally:
                release.set()
                first.join(3)
                if second.ident is not None:
                    second.join(3)
            self.assertTrue(second_done.is_set())
            self.assertEqual(len(calls), 1)


class OscBackportTests(unittest.TestCase):
    def test_second_avatar_invalidates_first_query_and_refreshes_latest_state(self):
        obj = object.__new__(model_module.Model)
        obj._inited = True
        obj.mic_mute_status = None
        obj._osc_mute_revision = 0
        obj._osc_receive_generation = 0
        obj._osc_mute_state_lock = threading.Lock()
        obj._osc_mute_refresh_lock = threading.Lock()
        entered, release, applied = threading.Event(), threading.Event(), threading.Event()
        queries, changes = [], []
        def query():
            queries.append(1)
            if len(queries) == 1:
                entered.set()
                release.wait(2)
                return False
            return True
        handlers = {}
        obj.osc_handler = SimpleNamespace(osc_parameter_muteself="/avatar/parameters/MuteSelf",
            getOSCParameterMuteSelf=query, setDictFilterAndTarget=handlers.update,
            receiveOscParameters=lambda: None, oscServerStop=lambda: None)
        def changed():
            changes.append(obj.mic_mute_status)
            applied.set()
        obj.changeMicTranscriptStatus = changed
        with patch.object(model_module, "config", SimpleNamespace(VRC_MIC_MUTE_SYNC=True, ENABLE_TRANSCRIPTION_SEND=True)):
            obj.startReceiveOSC()
            try:
                handlers["/avatar/change"]("/avatar/change", "A")
                self.assertTrue(entered.wait(1))
                handlers["/avatar/change"]("/avatar/change", "B")
                release.set()
                self.assertTrue(applied.wait(2))
                self.assertEqual(queries, [1, 1])
                self.assertEqual(changes, [True])
            finally:
                release.set()
                obj.stopReceiveOSC()

    def test_avatar_refresh_keeps_newer_live_mute_event(self):
        obj = object.__new__(model_module.Model)
        obj._inited = True
        obj.mic_mute_status = False
        obj._osc_mute_revision = 0
        obj._osc_mute_state_lock = threading.Lock()
        obj._osc_mute_refresh_lock = threading.Lock()
        obj._osc_receive_generation = 1
        entered, release = threading.Event(), threading.Event()
        def query():
            entered.set()
            release.wait(2)
            return False
        obj.osc_handler = SimpleNamespace(getOSCParameterMuteSelf=query)
        changes = []
        obj.changeMicTranscriptStatus = lambda: changes.append(obj.mic_mute_status)
        with patch.object(model_module, "config", SimpleNamespace(VRC_MIC_MUTE_SYNC=True, ENABLE_TRANSCRIPTION_SEND=True)):
            worker = threading.Thread(target=lambda: obj._refreshOscMuteState(1))
            worker.start()
            try:
                self.assertTrue(entered.wait(1))
                with obj._osc_mute_state_lock:
                    obj._osc_mute_revision += 1
                    obj.mic_mute_status = True
            finally:
                release.set()
                worker.join(3)
        self.assertTrue(obj.mic_mute_status)
        self.assertEqual(changes, [])

    def test_avatar_refresh_updates_mute_and_discards_stopped_session(self):
        obj = object.__new__(model_module.Model)
        obj._inited = True
        obj.mic_mute_status = None
        obj._osc_mute_revision = 0
        obj._osc_mute_state_lock = threading.Lock()
        obj._osc_mute_refresh_lock = threading.Lock()
        obj._osc_receive_generation = 2
        obj.osc_handler = SimpleNamespace(getOSCParameterMuteSelf=lambda: True)
        changes = []
        obj.changeMicTranscriptStatus = lambda: changes.append(obj.mic_mute_status)
        with patch.object(model_module, "config", SimpleNamespace(VRC_MIC_MUTE_SYNC=True, ENABLE_TRANSCRIPTION_SEND=True)):
            obj._refreshOscMuteState(1)
            self.assertIsNone(obj.mic_mute_status)
            obj._refreshOscMuteState(2)
        self.assertEqual(changes, [True])


if __name__ == "__main__":
    unittest.main()
