"""Instrument: subscribe to onGenerationTaskChanged in the live renderer, ask again, dump raw events."""
import json
import sys
import time

sys.path.insert(0, 'scripts')
from cdp_debug import connect_main

session, page = connect_main()

def ev(expr, await_promise=False):
    return session.evaluate(expr, await_promise=await_promise)

# Install a global event collector BEFORE asking
print('=== install event collector ===')
print(ev("""
(() => {
  window.__gcEvents = [];
  window.__gcUnsub = window.learningCompanion.onGenerationTaskChanged((event) => {
    window.__gcEvents.push({
      type: event.type,
      taskId: (event.snapshot && event.snapshot.id) || (event.taskId) || null,
      status: event.snapshot && event.snapshot.status,
      // for execution-event, capture the inner event type + a sample
      inner: event.event ? { type: event.event.type, deltaLen: event.event.delta ? event.event.delta.length : undefined, tool: event.event.toolName } : null,
      at: Date.now(),
    });
  });
  return 'installed';
})()
"""))

# Re-open AI dialog (it should still be open; if not, open it)
print('DIALOG OPEN:', ev('[...document.querySelectorAll("[role=dialog]")].some(d => d.innerText.includes("AI 对话"))'))
if not ev('[...document.querySelectorAll("[role=dialog]")].some(d => d.innerText.includes("AI 对话"))'):
    print(ev("""
    (() => {
      const b = [...document.querySelectorAll('button')].find(x => x.innerText.includes('AI 对话'));
      if (b) { b.click(); return 'opened'; }
      return 'no btn';
    })()
    """))
    time.sleep(1.2)

# Ask again
print('=== ask again ===')
print(ev("""
(() => {
  const ta = document.querySelector('textarea');
  if (!ta) return 'no textarea';
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, '你好，请简单回应一下。');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  return 'typed';
})()
"""))
time.sleep(0.4)
print(ev("""
(() => {
  const dlg = [...document.querySelectorAll('[role=dialog]')].find(d => d.innerText.includes('AI 对话'));
  const btns = [...dlg.querySelectorAll('button')];
  const send = btns.find(b => (b.getAttribute('aria-label') || '').includes('发送'));
  if (send) { send.click(); return 'sent'; }
  return 'no send';
})()
"""))

# Wait and dump collected events
print('\n=== collected events (first 12s) ===')
for i in range(8):
    time.sleep(1.5)
    n = ev('window.__gcEvents.length')
    print(f'[t+{i*1.5:.0f}s] events so far: {n}')
    if n and n > 0:
        break

events = ev('JSON.stringify(window.__gcEvents)')
print('\nRAW EVENTS:', events[:3000])
print('\nEVENT TYPE COUNTS:')
print(ev("""
(() => {
  const counts = {};
  for (const e of window.__gcEvents) {
    const k = e.type + (e.inner ? '/' + e.inner.type : '');
    counts[k] = (counts[k] || 0) + 1;
  }
  return JSON.stringify(counts);
})()
"""))

session.close()
