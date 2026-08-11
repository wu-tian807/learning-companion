"""Full E2E: open project -> open HTML asset -> AI dialog -> ask -> watch stream.

Clickable targets:
- project card: <article> containing 'test' + 'Asset'
- asset button: <button> containing 'wu-tian807'
- AI dialog button: <button> containing 'AI 对话'
"""
import json
import sys
import time

sys.path.insert(0, 'scripts')
from cdp_debug import connect_main

session, page = connect_main()

def ev(expr, await_promise=False):
    return session.evaluate(expr, await_promise=await_promise)

def click_project():
    return ev("""
    (() => {
      const card = [...document.querySelectorAll('article')].find(x => x.innerText.includes('test') && x.innerText.includes('Asset'));
      if (card) { card.click(); return 'ok'; }
      return 'no article card';
    })()
    """)

# 1. Open test project
print('=== 1. open project ===')
print(click_project())
time.sleep(2.5)
print('BODY:', ev('document.body.innerText.slice(0, 150)').replace('\n', ' | '))

# 2. Open HTML asset
print('=== 2. open HTML asset ===')
print(ev("""
(() => {
  const b = [...document.querySelectorAll('button')].find(x => x.innerText.includes('wu-tian807'));
  if (b) { b.click(); return 'ok'; }
  return 'no asset button';
})()
"""))
time.sleep(3)
print('FRAMES:', ev('[...document.querySelectorAll("iframe")].map(f => f.src)'))

# 3. Open AI dialog
print('=== 3. open AI dialog ===')
print(ev("""
(() => {
  const b = [...document.querySelectorAll('button')].find(x => x.innerText.includes('AI 对话'));
  if (b) { b.click(); return 'ok'; }
  return 'no AI button';
})()
"""))
time.sleep(1.5)
print('DIALOG OPEN:', ev('[...document.querySelectorAll("[role=dialog]")].some(d => d.innerText.includes("AI 对话"))'))

# 4. Type + submit
print('=== 4. ask question ===')
print(ev("""
(() => {
  const ta = document.querySelector('textarea');
  if (!ta) return 'no textarea';
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, '用一句话回答：这个页面讲的是什么？');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  return 'typed';
})()
"""))
time.sleep(0.4)
print(ev("""
(() => {
  const dlg = [...document.querySelectorAll('[role=dialog]')].find(d => d.innerText.includes('AI 对话'));
  if (!dlg) return 'no dlg';
  const btns = [...dlg.querySelectorAll('button')];
  const send = btns.find(b => (b.getAttribute('aria-label') || '').includes('发送'))
    || btns.find(b => b.querySelector('svg') && !b.innerText.trim() && !b.getAttribute('aria-label')?.includes('关闭') && !b.getAttribute('aria-label')?.includes('返回'));
  if (send) { send.click(); return 'sent: ' + (send.getAttribute('aria-label') || 'icon'); }
  return 'no send btn: ' + btns.map(b => (b.getAttribute('aria-label')||'') + '/' + b.innerText.slice(0,8)).join(' | ');
})()
"""))

# 5. Watch the streaming answer
print('\n=== 5. watch answer ===')
for i in range(30):
    time.sleep(1.5)
    state = ev("""
    (() => {
      const dlg = [...document.querySelectorAll('[role=dialog]')].find(d => d.innerText.includes('AI 对话'));
      if (!dlg) return 'no dialog';
      const texts = [...dlg.querySelectorAll('div, p, span')]
        .filter(el => el.innerText && el.innerText.trim().length > 0 && el.children.length === 0)
        .map(el => el.innerText.trim());
      return JSON.stringify({ tail: texts.slice(-8) });
    })()
    """)
    print(f'[t+{i*1.5:.0f}s]', state)
    if isinstance(state, str) and state.startswith('{'):
        tail = json.loads(state)['tail']
        if any(len(m) > 50 for m in tail):
            print('>>> ANSWER PRESENT')
            break

session.close()
