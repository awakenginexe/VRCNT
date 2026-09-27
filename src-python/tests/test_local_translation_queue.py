"""Bounded, fair dispatch of local translation inference."""

import os
import sys
import threading
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from models.pipeline.local_translation_queue import LocalTranslationQueue
from models.pipeline.pipeline_types import PipelineSource
from models.pipeline.source_pipeline import SourcePipeline
from test_translation_scheduler import Recorder, ScriptedTranslator, make_trace


class LocalTranslationQueueTests(unittest.TestCase):
    def setUp(self):
        self.queue = LocalTranslationQueue(max_pending_per_source=2)
        self.addCleanup(self.queue.close)

    def test_round_robin_between_mic_and_speaker(self):
        entered = threading.Event()
        release = threading.Event()
        finished = threading.Event()
        calls = []
        owner = object()

        def first():
            entered.set()
            release.wait(1)
            calls.append("mic-0")

        self.assertTrue(self.queue.offer(PipelineSource.MIC, owner, "mic-0", first))
        self.assertTrue(entered.wait(1))
        self.assertTrue(self.queue.offer(PipelineSource.MIC, owner, "mic-1", lambda: calls.append("mic-1")))
        self.assertTrue(self.queue.offer(PipelineSource.SPEAKER, owner, "speaker-0", lambda: calls.append("speaker-0")))
        self.assertTrue(self.queue.offer(PipelineSource.MIC, owner, "mic-2", lambda: (calls.append("mic-2"), finished.set())))
        release.set()
        self.assertTrue(finished.wait(1))
        self.assertEqual(calls, ["mic-0", "speaker-0", "mic-1", "mic-2"])

    def test_pending_limit_rejects_extra_work_without_spawning_workers(self):
        entered = threading.Event()
        release = threading.Event()
        owner = object()

        def blocked():
            entered.set()
            release.wait(1)

        self.assertTrue(self.queue.offer(PipelineSource.MIC, owner, "active", blocked))
        self.assertTrue(entered.wait(1))
        self.assertTrue(self.queue.offer(PipelineSource.MIC, owner, "pending-1", lambda: None))
        self.assertTrue(self.queue.offer(PipelineSource.MIC, owner, "pending-2", lambda: None))
        self.assertFalse(self.queue.offer(PipelineSource.MIC, owner, "overflow", lambda: None))
        self.assertEqual(self.queue.pending_count(PipelineSource.MIC), 2)
        self.assertTrue(self.queue.worker_thread.is_alive())
        release.set()
        self.queue.wait_owner_idle(owner)

    def test_cancel_removes_only_owners_pending_work(self):
        entered = threading.Event()
        release = threading.Event()
        calls = []
        first_owner = object()
        other_owner = object()

        def blocked():
            entered.set()
            release.wait(1)

        self.queue.offer(PipelineSource.MIC, first_owner, "active", blocked)
        self.assertTrue(entered.wait(1))
        self.queue.offer(PipelineSource.MIC, first_owner, "stale", lambda: calls.append("stale"))
        self.queue.offer(PipelineSource.SPEAKER, other_owner, "keep", lambda: calls.append("keep"))
        self.assertEqual(self.queue.cancel_owner(first_owner), ["stale"])
        release.set()
        self.queue.wait_owner_idle(first_owner)
        self.queue.wait_owner_idle(other_owner)
        self.assertEqual(calls, ["keep"])


class LocalPipelineTests(unittest.TestCase):
    @staticmethod
    def wait_until(predicate, timeout=1):
        deadline = time.monotonic() + timeout
        while not predicate() and time.monotonic() < deadline:
            time.sleep(0.005)
        return predicate()

    def setUp(self):
        self.queue = LocalTranslationQueue(max_pending_per_source=2)
        self.addCleanup(self.queue.close)
        self.patch = patch("models.pipeline.source_pipeline.shared_local_translation_queue", return_value=self.queue)
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def pipeline(self, source, translator, recorder):
        pipeline = SourcePipeline(
            source=source,
            translator=translator,
            transliterate=lambda *args: (),
            emit_initial=recorder.emit_initial,
            emit_update=recorder.emit_update,
            emit_metric=recorder.emit_metric,
            emit_final=recorder.emit_final,
            is_generation_current=lambda generation: generation == 7,
        )
        pipeline.start(7)
        self.addCleanup(lambda: pipeline.stop(7))
        return pipeline

    def test_local_overload_finalizes_explicitly_while_cloud_stays_available(self):
        translator = ScriptedTranslator()
        translator.block_message = "one"
        recorder = Recorder()
        pipeline = self.pipeline(PipelineSource.MIC, translator, recorder)
        self.assertTrue(pipeline.submit_trace(make_trace("one", providers=("CTranslate2",))))
        self.assertTrue(translator.entered.wait(1))
        for trace_id in ("two", "three", "four"):
            self.assertTrue(pipeline.submit_trace(make_trace(trace_id, providers=("CTranslate2",))))
            if trace_id != "four":
                self.assertTrue(self.wait_until(lambda: self.queue.pending_count(PipelineSource.MIC) == (1 if trace_id == "two" else 2)))
        self.assertTrue(recorder.wait_for(lambda: any(
            update.trace_id == "four" and update.error_code == "local_translation_queue_overload"
            for update in recorder.updates
        )))
        self.assertTrue(recorder.wait_for(lambda: any(task.trace_id == "four" for task in recorder.finals)))
        self.assertTrue(pipeline.submit_trace(make_trace("cloud", providers=("Google",))))
        self.assertTrue(recorder.wait_for(lambda: any(task.trace_id == "cloud" for task in recorder.finals)))
        translator.release.set()

    def test_stop_cancels_queued_local_inference_and_reports_it(self):
        translator = ScriptedTranslator()
        translator.block_message = "one"
        recorder = Recorder()
        pipeline = self.pipeline(PipelineSource.MIC, translator, recorder)
        pipeline.submit_trace(make_trace("one", providers=("CTranslate2",)))
        self.assertTrue(translator.entered.wait(1))
        pipeline.submit_trace(make_trace("two", providers=("CTranslate2",)))
        self.assertTrue(self.wait_until(lambda: self.queue.pending_count(PipelineSource.MIC) == 1))
        stopped = threading.Event()
        stopper = threading.Thread(target=lambda: (pipeline.stop(7), stopped.set()))
        stopper.start()
        self.addCleanup(stopper.join)
        self.assertTrue(recorder.wait_for(lambda: any(
            metric.trace_id == "two" and metric.error_code == "translation_generation_cancelled"
            for metric in recorder.metrics
        )))
        self.assertFalse(stopped.is_set())
        translator.release.set()
        self.assertTrue(stopped.wait(2))
        self.assertNotIn("two", [call["message"] for call in translator.calls])
        self.assertFalse(any(task.trace_id in {"one", "two"} for task in recorder.finals))

    def test_stop_from_local_sending_callback_does_not_deadlock(self):
        translator = ScriptedTranslator()
        recorder = Recorder()
        pipeline = self.pipeline(PipelineSource.MIC, translator, recorder)
        stopped = threading.Event()

        def emit_update(update):
            recorder.emit_update(update)
            if update.status.value == "sending" and update.engine == "CTranslate2":
                pipeline.stop(7)
                stopped.set()

        pipeline._emit_update = emit_update
        pipeline.submit_trace(make_trace("one", providers=("CTranslate2",)))
        self.assertTrue(stopped.wait(2))
        self.assertEqual(translator.calls, [])


if __name__ == "__main__":
    unittest.main()
