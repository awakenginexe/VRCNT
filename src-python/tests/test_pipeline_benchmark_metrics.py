import json
import os
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from controller import Controller
from models.pipeline.benchmark_metrics import BENCHMARK_METRICS_ENV
from models.pipeline.pipeline_types import PipelineSource, PipelineStatusEvent


class PipelineBenchmarkMetricsTests(unittest.TestCase):
    def test_opt_in_writes_only_numeric_and_category_fields(self):
        controller = object.__new__(Controller)
        controller.run = Mock()
        controller.run_mapping = {}
        event = PipelineStatusEvent(
            schema_version=1,
            trace_id="conversation must not be saved",
            source=PipelineSource.MIC,
            stage="output",
            engine="CTranslate2",
            target_slot="slot",
            outcome="success",
            queue_age_ms=12,
            duration_ms=145,
            queue_depth=0,
            dropped_count=0,
            observed_at_ms=1234,
            error_code=None,
            speech_to_output_ms=105,
        )
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "metrics.jsonl")
            with patch.dict(os.environ, {BENCHMARK_METRICS_ENV: path}):
                controller._emitPipelineStatus(event)
            with open(path, encoding="utf-8") as file:
                stored = json.loads(file.read())
            self.assertEqual(stored["speech_to_output_ms"], 105)
            self.assertEqual(stored["source"], "mic")
            self.assertNotIn("trace_id", stored)
            self.assertNotIn("target_slot", stored)
            self.assertNotIn("conversation", json.dumps(stored))
            controller.run.assert_called_once()

    def test_default_does_not_write_benchmark_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "metrics.jsonl")
            with patch.dict(os.environ, {BENCHMARK_METRICS_ENV: ""}):
                controller = object.__new__(Controller)
                controller.run = Mock()
                controller.run_mapping = {}
                controller._emitPipelineStatus(PipelineStatusEvent(
                    1, None, PipelineSource.MIC, "queue", None, None,
                    "success", 1, None, 0, 0, 1234, None,
                ))
            self.assertFalse(os.path.exists(path))


if __name__ == "__main__":
    unittest.main()
