"""Regression tests for OSCQuery setup and shutdown boundaries."""

import os
import sys
import threading
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from models.osc import osc


class FakeServer:
    instances = []

    def __init__(self, address, dispatcher):
        self.address = address
        self.stopped = threading.Event()
        self.closed = False
        self.__class__.instances.append(self)

    def serve_forever(self, poll_interval):
        self.stopped.wait(2)

    def shutdown(self):
        self.stopped.set()

    def server_close(self):
        self.closed = True


class FailingService:
    attempts = 0
    partials = []
    first_failure = threading.Event()

    def __init__(self, *_args):
        self.__class__.attempts += 1
        self._zeroconf = type("Zeroconf", (), {"closed": False, "close": lambda self: setattr(self, "closed", True)})()
        self.__class__.partials.append(self)
        self.__class__.first_failure.set()
        raise OSError("OSCQuery HTTP bind failed")


class OSCQueryLifecycleTests(unittest.TestCase):
    def setUp(self):
        FakeServer.instances = []
        FailingService.attempts = 0
        FailingService.partials = []
        FailingService.first_failure = threading.Event()
        self.sleep_calls = 0
        def bounded_sleep(_seconds):
            self.sleep_calls += 1
            if self.sleep_calls >= 5:
                raise AssertionError("OSCQuery retried beyond five attempts")
        self.patches = [
            patch.object(osc.osc_server, "ThreadingOSCUDPServer", FakeServer),
            patch.object(osc, "OSCQueryService", FailingService),
            patch.object(osc, "get_open_udp_port", return_value=9061),
            patch.object(osc, "get_open_tcp_port", return_value=9062),
            patch.object(osc, "errorLogging"),
            patch.object(osc, "sleep", side_effect=bounded_sleep),
        ]
        for item in self.patches:
            item.start()
            self.addCleanup(item.stop)
        self.handler = osc.OSCHandler()
        self.addCleanup(self.handler.closeChatboxDispatcher)
        self.addCleanup(self.handler.oscServerStop)

    def test_query_failure_is_bounded_and_leaves_osc_available(self):
        self.handler.receiveOscParameters()
        self.assertEqual(FailingService.attempts, 5)
        self.assertIn("OSCQuery", self.handler.osc_query_failure)
        self.assertIsNotNone(self.handler.osc_server)
        self.assertTrue(all(item._zeroconf.closed for item in FailingService.partials))
        self.handler.sendTyping(True)

    def test_shutdown_interrupts_retry_and_closes_server(self):
        worker = threading.Thread(target=self.handler.receiveOscParameters)
        worker.start()
        self.assertTrue(FailingService.first_failure.wait(1))
        self.handler.oscServerStop()
        worker.join(0.5)
        self.assertFalse(worker.is_alive())
        self.assertTrue(FakeServer.instances[0].closed)
        self.assertIsNone(self.handler.osc_server)

    def test_ip_and_port_change_discard_old_server_and_keep_new_target(self):
        self.handler.receiveOscParameters()
        old_server = FakeServer.instances[-1]
        self.handler.setOscIpAddress("192.0.2.10")
        self.assertTrue(old_server.closed)
        self.assertEqual(self.handler.osc_ip_address, "192.0.2.10")
        self.assertIsNone(self.handler.osc_server)
        self.handler.setOscPort(9011)
        self.assertEqual(self.handler.osc_port, 9011)
        self.handler.setOscIpAddress("127.0.0.1")
        self.assertEqual(FakeServer.instances[-1].address[0], "127.0.0.1")


if __name__ == "__main__":
    unittest.main()
