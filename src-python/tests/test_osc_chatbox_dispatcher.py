import os
import sys
import threading
import time
import unittest


sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from models.osc.chatbox_dispatcher import ChatboxDispatcher


class ChatboxDispatcherTests(unittest.TestCase):
    def setUp(self):
        self.delivered = []
        self.delivered_event = threading.Event()

        def send(message):
            self.delivered.append(message)
            self.delivered_event.set()

        self.dispatcher = ChatboxDispatcher(send)

    def tearDown(self):
        self.dispatcher.close()

    def _wait_for_count(self, count):
        deadline = time.monotonic() + 1.0
        while len(self.delivered) < count and time.monotonic() < deadline:
            self.delivered_event.wait(0.05)
            self.delivered_event.clear()
        self.assertGreaterEqual(len(self.delivered), count)

    def test_fifo_delivery_keeps_original_before_translation(self):
        self.assertTrue(self.dispatcher.enqueue("original", generation=1))
        self.assertTrue(self.dispatcher.enqueue("translation", generation=1))

        self._wait_for_count(2)

        self.assertEqual(self.delivered, ["original", "translation"])

    def test_enqueue_has_no_artificial_rate_limit_delay(self):
        started = time.monotonic()
        self.assertTrue(self.dispatcher.enqueue("message"))
        self._wait_for_count(1)

        self.assertLess(time.monotonic() - started, 0.5)

    def test_invalidated_generation_rejects_new_and_removes_queued_messages(self):
        blocked = threading.Event()
        release = threading.Event()
        delivered = []

        def send(message):
            delivered.append(message)
            if message == "first":
                blocked.set()
                release.wait(1.0)

        dispatcher = ChatboxDispatcher(send)
        try:
            self.assertTrue(dispatcher.enqueue("first", generation=4))
            self.assertTrue(dispatcher.enqueue("stale", generation=4))
            self.assertTrue(blocked.wait(1.0))
            dispatcher.invalidate_generation(4)
            self.assertFalse(dispatcher.enqueue("later-stale", generation=4))
            release.set()
            deadline = time.monotonic() + 1.0
            while time.monotonic() < deadline and delivered != ["first"]:
                time.sleep(0.01)
            self.assertEqual(delivered, ["first"])
        finally:
            dispatcher.close()

    def test_clear_drops_pending_work_without_closing_dispatcher(self):
        blocked = threading.Event()
        release = threading.Event()
        delivered = []

        def send(message):
            delivered.append(message)
            if message == "first":
                blocked.set()
                release.wait(1.0)

        dispatcher = ChatboxDispatcher(send)
        try:
            self.assertTrue(dispatcher.enqueue("first"))
            self.assertTrue(dispatcher.enqueue("cleared"))
            self.assertTrue(blocked.wait(1.0))
            dispatcher.clear()
            release.set()
            deadline = time.monotonic() + 1.0
            while time.monotonic() < deadline and delivered != ["first"]:
                time.sleep(0.01)
            self.assertEqual(delivered, ["first"])
            self.assertTrue(dispatcher.enqueue("after-clear"))
            deadline = time.monotonic() + 1.0
            while time.monotonic() < deadline and delivered != ["first", "after-clear"]:
                time.sleep(0.01)
            self.assertEqual(delivered, ["first", "after-clear"])
        finally:
            dispatcher.close()


if __name__ == "__main__":
    unittest.main()
