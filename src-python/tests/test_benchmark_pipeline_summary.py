import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "utils")))
from benchmark_pipeline_metrics import summarize


class BenchmarkPipelineSummaryTests(unittest.TestCase):
    def test_queue_wait_is_taken_before_inference_and_trim_is_visible(self):
        events = [
            {"stage": "translation", "outcome": "sending", "queue_age_ms": 12, "source": "mic", "dropped_count": 0},
            {"stage": "translation", "outcome": "success", "queue_age_ms": 512, "duration_ms": 500, "source": "mic", "dropped_count": 0},
            {"stage": "output", "outcome": "success", "speech_to_output_ms": 600, "source": "mic", "dropped_count": 0},
            {"stage": "audio_input", "outcome": "input_trimmed", "audio_trimmed_ms": 1000},
            {"stage": "translation", "outcome": "skipped_overload", "source": "mic", "dropped_count": 1},
        ]
        result = summarize(events, "combined", resources=[{"ram_used_mb": 1000, "gpu_total_used_mb": 3000}], frame_times=[11, 12])
        self.assertEqual(result["queue_wait_ms"]["translation"]["p50"], 12)
        self.assertEqual(result["inference_ms"]["translation"]["p50"], 500)
        self.assertEqual(result["speech_end_to_final_ms"]["p50"], 600)
        self.assertEqual(result["audio_input_trimmed_ms"], 1000)
        self.assertEqual(result["overload_count"], 1)
        self.assertEqual(result["dropped_count_by_source"], {"mic": 1})
        self.assertIsNone(result["quality"])

    def test_stopped_audio_backlog_counts_as_cancelled_and_dropped(self):
        events = [
            {"stage": "queue", "outcome": "skipped", "source": "speaker",
             "error_code": "audio_queue_cancelled", "dropped_count": 5},
            {"stage": "transcription", "outcome": "skipped", "source": "speaker",
             "error_code": "transcription_generation_retired", "dropped_count": 0},
        ]
        result = summarize(events, "switch-model")
        self.assertEqual(result["cancelled_count"], 2)
        self.assertEqual(result["dropped_count_by_source"], {"speaker": 5})


if __name__ == "__main__":
    unittest.main()
