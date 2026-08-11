"""Minimal Chrome DevTools Protocol driver for the Electron app.

Connects to the remote debugging port (9222) and exposes evaluate helpers
so we can drive the real application and inspect Workbench components.

Usage:
    import sys; sys.path.insert(0, 'scripts')
    from cdp_debug import CdpSession, connect_main

    session, page = connect_main()        # main window
    print(session.evaluate('document.title'))
    session.close()

Attaching to the sandbox iframe: list_pages() includes learning-content://
targets; connect a CdpSession to its webSocketDebuggerUrl to execute JS
inside the frame (selection, DOM reads).
"""
import json
import urllib.request

import websocket


def list_pages(port=9222):
    with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list") as resp:
        return json.load(resp)


class CdpSession:
    def __init__(self, ws_url):
        # Chromium validates the Sec-WebSocket Origin header; devtools
        # clients use devtools://devtools. --remote-allow-origins is
        # swallowed by electron-forge, so spoof the header instead.
        self.ws = websocket.create_connection(
            ws_url,
            timeout=30,
            origin="devtools://devtools",
            suppress_origin=True,
        )
        self._id = 0

    def send(self, method, params=None):
        self._id += 1
        msg_id = self._id
        self.ws.send(json.dumps({"id": msg_id, "method": method, "params": params or {}}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == msg_id:
                return msg

    def evaluate(self, expression, await_promise=False):
        params = {
            "expression": expression,
            "returnByValue": True,
        }
        if await_promise:
            params["awaitPromise"] = True
        result = self.send("Runtime.evaluate", params)
        if "exceptionDetails" in result.get("result", {}):
            return {"error": result["result"]["exceptionDetails"].get("text")}
        return result["result"].get("result", {}).get("value")

    def close(self):
        self.ws.close()


def connect_main(port=9222):
    pages = list_pages(port)
    page = next((p for p in pages if p["type"] == "page"), pages[0])
    return CdpSession(page["webSocketDebuggerUrl"]), page


if __name__ == "__main__":
    import sys

    session, page = connect_main()
    print("TITLE:", session.evaluate("document.title"))
    print("URL:", page["url"])
    print("HAS_PRELOAD:", session.evaluate("typeof window.learningCompanion"))
    session.close()
    sys.exit(0)
