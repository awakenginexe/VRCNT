"""OSC helpers and a thin OSCQuery-enabled server wrapper.

This module provides `OSCHandler`, a convenience wrapper used by the
application to send OSC messages and expose OSCQuery endpoints when the
target address is localhost. The implementation is defensive: missing
utilities are handled gracefully and logging helpers are used where
available.
"""

import time
import logging
from typing import Any, Callable, Dict, Optional
from time import sleep
from threading import Event, Lock, Thread
from pythonosc import udp_client, dispatcher, osc_server
from models.osc.chatbox_dispatcher import ChatboxDispatcher

logger = logging.getLogger(__name__)
try:
    from tinyoscquery.queryservice import OSCQueryService
    from tinyoscquery.query import OSCQueryBrowser, OSCQueryClient
    from tinyoscquery.utility import get_open_udp_port, get_open_tcp_port
    from tinyoscquery.shared.node import OSCAccess
except Exception:
    # tinyoscquery is optional for non-local usage; functionality that
    # depends on it will be disabled if it's missing.
    OSCQueryService = None  # type: ignore
    OSCQueryBrowser = None  # type: ignore
    OSCQueryClient = None  # type: ignore
    def get_open_udp_port() -> int:  # type: ignore
        return 0

    def get_open_tcp_port() -> int:  # type: ignore
        return 0
    OSCAccess = None  # type: ignore

try:
    from utils import errorLogging
except Exception:
    def errorLogging() -> None:
        import traceback
        print("Error occurred:", traceback.format_exc())

class OSCHandler:
    """Thin wrapper managing OSC send/receive and optional OSCQuery advertising.

    Args:
        ip_address: OSC server client target / bind address
        port: UDP port to send to
    """

    def __init__(self, ip_address: str = "127.0.0.1", port: int = 9000) -> None:

        self.is_osc_query_enabled: bool = ip_address in ["127.0.0.1", "localhost"]

        self.osc_ip_address: str = ip_address
        self.osc_port: int = port
        self.osc_parameter_muteself: str = "/avatar/parameters/MuteSelf"
        self.osc_parameter_chatbox_typing: str = "/chatbox/typing"
        self.osc_parameter_chatbox_input: str = "/chatbox/input"
        self.udp_client = udp_client.SimpleUDPClient(self.osc_ip_address, self.osc_port)
        self.osc_server_name: str = "VRChat-Client"
        self.osc_server = None
        self.osc_query_service = None
        self.osc_query_service_name: str = "VRCT"
        self.osc_server_ip_address: str = ip_address
        self.http_port: Optional[int] = None
        self.osc_server_port: Optional[int] = None
        self.dict_filter_and_target: Dict[str, Callable] = {}
        self.browser = None
        self.osc_query_failure: Optional[str] = None
        self._state_lock = Lock()
        self._retry_cancel = Event()
        self._chatbox_dispatcher = ChatboxDispatcher(
            self._sendMessageNow,
            send_with_metadata=self._sendMessageWithMetadata,
        )

    def getIsOscQueryEnabled(self) -> bool:
        """Return whether OSCQuery support is enabled (local addresses only)."""
        return self.is_osc_query_enabled

    def setOscIpAddress(self, ip_address: str) -> None:
        """Change the OSC target IP address and reinitialize services."""
        self.is_osc_query_enabled = ip_address in ["127.0.0.1", "localhost"]

        self.oscServerStop()
        previous_client = self.udp_client
        self.osc_ip_address = ip_address
        self.osc_server_ip_address = ip_address
        self.udp_client = udp_client.SimpleUDPClient(self.osc_ip_address, self.osc_port)
        previous_client._sock.close()
        self.receiveOscParameters()

    def setOscPort(self, port: int) -> None:
        """Change the OSC UDP port used for sending and reinitialize services."""
        self.oscServerStop()
        previous_client = self.udp_client
        self.osc_port = port
        self.udp_client = udp_client.SimpleUDPClient(self.osc_ip_address, self.osc_port)
        previous_client._sock.close()
        self.receiveOscParameters()

    # send OSC message typing
    def sendTyping(self, flag: bool = False) -> None:
        """Send /chatbox/typing with a boolean flag."""
        self.udp_client.send_message(self.osc_parameter_chatbox_typing, [flag])

    # send OSC message
    def _sendMessageNow(self, message: str, notification: bool = True) -> None:
        self.udp_client.send_message(
            self.osc_parameter_chatbox_input,
            [f"{message}", True, notification],
        )

    def _sendMessageWithMetadata(self, message: str, notification: bool) -> None:
        self._sendMessageNow(message, notification)

    def sendMessage(
        self,
        message: str = "",
        notification: bool = True,
        generation: Optional[int] = None,
    ) -> bool:
        """Send /chatbox/input if message is non-empty.

        The second argument historically was a boolean flag for clearing; we keep
        compatibility by sending [message, True, notification].
        """
        return self._chatbox_dispatcher.enqueue(
            message,
            generation=generation,
            notification=notification,
        )

    def clearChatboxQueue(self) -> None:
        self._chatbox_dispatcher.clear()

    def invalidateChatboxGeneration(self, generation: int) -> None:
        self._chatbox_dispatcher.invalidate_generation(generation)

    def closeChatboxDispatcher(self) -> None:
        self._chatbox_dispatcher.close()

    def getOSCParameterValue(self, address: str) -> Any:
        if not self.is_osc_query_enabled:
            # OSCQueryが無効な場合はNoneを返す
            return None
        value: Any = None
        try:
            # browserインスタンスを再利用し、毎回の生成と破棄を避ける
            if self.browser is None:
                # OSCQueryBrowser may not be available; guard
                if OSCQueryBrowser is None:
                    return None
                self.browser = OSCQueryBrowser()
                sleep(1)  # 初回のみスリープ

            service = self.browser.find_service_by_name(self.osc_server_name)
            if service is not None:
                osc_query_client = OSCQueryClient(service)
                mute_self_node = osc_query_client.query_node(address)
                # mute_self_node may be None when the node is not present on the
                # remote OSCQuery service. Also mute_self_node.value may be None
                # or an empty list. Guard against those cases to avoid
                # AttributeError: 'NoneType' object has no attribute 'value'
                if mute_self_node is None:
                    return None
                # prefer explicit checks rather than relying on exceptions
                node_value = getattr(mute_self_node, 'value', None)
                if not node_value:
                    return None
                value = node_value[0]
        except Exception:
            errorLogging()
            # エラー発生時にbrowserをリセットして次回再初期化
            if self.browser is not None:
                try:
                    if hasattr(self.browser, 'zc') and self.browser.zc is not None:
                        self.browser.zc.close()
                    if hasattr(self.browser, 'browser') and self.browser.browser is not None:
                        self.browser.browser.cancel()
                except Exception:
                    pass
                self.browser = None
        return value

    def getOSCParameterMuteSelf(self) -> Optional[bool]:
        """Return the value of the MuteSelf parameter when available, else None."""
        return self.getOSCParameterValue(self.osc_parameter_muteself)

    def setDictFilterAndTarget(self, dict_filter_and_target: Dict[str, Callable]) -> None:
        """Set the mapping from OSC address filters to handler callables."""
        self.dict_filter_and_target = dict_filter_and_target

    def receiveOscParameters(self) -> None:
        """Start a local OSC server and advertise OSCQuery endpoints when supported.

        If `tinyoscquery` is not available or OSCQuery is disabled, this is a
        no-op.
        """
        if not self.is_osc_query_enabled or OSCQueryService is None:
            # OSCQuery が無効またはライブラリが無い場合は何もしない
            return

        self.oscServerStop()
        retry_cancel = Event()
        osc_server_port = get_open_udp_port()
        http_port = get_open_tcp_port()
        osc_dispatcher = dispatcher.Dispatcher()
        for filter, target in self.dict_filter_and_target.items():
            osc_dispatcher.map(filter, target)
        with self._state_lock:
            self._retry_cancel = retry_cancel
            self.osc_server_port = osc_server_port
            self.http_port = http_port
            self.osc_query_failure = None
            server = osc_server.ThreadingOSCUDPServer((self.osc_server_ip_address, osc_server_port), osc_dispatcher)
            self.osc_server = server
            Thread(target=self.oscServerServe, args=(server,), daemon=True).start()

        for attempt in range(5):
            if retry_cancel.is_set():
                return
            service = OSCQueryService.__new__(OSCQueryService)
            try:
                # osc_server_name + UTC timestamp でユニークなサービス名を生成
                service_name = f"{self.osc_query_service_name}:{int(time.time())}"
                OSCQueryService.__init__(service, service_name, http_port, osc_server_port)
                for filter, target in self.dict_filter_and_target.items():
                    # OSCAccess may be None when tinyoscquery is not present; guard
                    if OSCAccess is not None:
                        service.advertise_endpoint(filter, access=OSCAccess.READWRITE_VALUE)
                with self._state_lock:
                    if not retry_cancel.is_set() and self._retry_cancel is retry_cancel:
                        self.osc_query_service = service
                        return
                self._close_query_service(service)
                return
            except Exception as exc:
                errorLogging()
                self._close_query_service(service)
                if retry_cancel.is_set():
                    return
                if attempt == 4:
                    with self._state_lock:
                        if self._retry_cancel is retry_cancel:
                            self.osc_query_failure = f"OSCQuery unavailable after 5 attempts: {exc}"
                    logger.warning("%s; ordinary OSC remains available", self.osc_query_failure)
                    return
                retry_cancel.wait(1)

    def oscServerServe(self, server=None) -> None:
        """Run the OSC server loop with a longer poll interval to reduce CPU."""
        server = server if server is not None else self.osc_server
        if server is not None:
            server.serve_forever(0.5)

    @staticmethod
    def _close_query_service(service) -> None:
        if service is None:
            return
        http_server = getattr(service, "http_server", None)
        if http_server is not None:
            try:
                http_thread = getattr(service, "http_thread", None)
                if http_thread is not None and http_thread.is_alive():
                    http_server.shutdown()
                http_server.server_close()
            except Exception:
                logger.exception("Could not close OSCQuery HTTP server")
        zeroconf = getattr(service, "_zeroconf", None)
        if zeroconf is not None:
            try:
                zeroconf.close()
            except Exception:
                logger.exception("Could not close OSCQuery discovery")

    def oscServerStop(self) -> None:
        """Stop and clean up any running OSC server and OSCQuery service."""
        with self._state_lock:
            self._retry_cancel.set()
            server = self.osc_server
            self.osc_server = None
            service = self.osc_query_service
            self.osc_query_service = None
        if server is not None:
            try:
                server.shutdown()
                server.server_close()
            except Exception:
                logger.exception("Could not close OSC server")
        self._close_query_service(service)
        # browser がある場合はクリーンアップ
        if self.browser is not None:
            try:
                if hasattr(self.browser, 'zc') and self.browser.zc is not None:
                    self.browser.zc.close()
                if hasattr(self.browser, 'browser') and self.browser.browser is not None:
                    self.browser.browser.cancel()
            except Exception:
                pass
            self.browser = None

if __name__ == "__main__":
    handler = OSCHandler()
    handler.setDictFilterAndTarget({
        "/avatar/parameters/MuteSelf": lambda address, *args: print(f"Received {address} with args {args}"),
        "/chatbox/typing": lambda address, *args: print(f"Received {address} with args {args}"),
        "/chatbox/input": lambda address, *args: print(f"Received {address} with args {args}"),
    })
    handler.receiveOscParameters()
    sleep(5)
    handler.sendTyping(True)
    sleep(1)
    handler.sendMessage(message="Hello World 1", notification=True)
    sleep(10)

    print("IP address changed to 192.168.193.2")
    handler.setOscIpAddress("192.168.193.2")
    sleep(5)
    handler.sendMessage(message="Hello World 2", notification=True)

    print("IP address changed to 127.0.0.1")
    handler.setOscIpAddress("127.0.0.1")
    sleep(5)
    handler.sendMessage(message="Hello World 3", notification=True)
    sleep(10)
    handler.oscServerStop()
