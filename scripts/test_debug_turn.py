"""Drive the app through the HTML conversation flow, then read the debug dump."""
import json
import sys
import time

sys.path.insert(0, 'scripts')
from cdp_debug import connect_main

session, page = connect_main()

def ev(expr, await_promise=False):
    return session.evaluate(expr, await_promise=await_promise)

# 1. open project
print('1. project:', ev("""
(() => {
  const card = [...document.querySelectorAll('article')].find(x => x.innerText.includes('test') && x.innerText.includes('Asset'));
  if (card) { card.click(); return 'ok'; }
  return 'no card';
})()
"""))
time.sleep(2.5)

# 2. open asset (first open the asset panel if needed)
print('2. asset:', ev("""
(() => {
  const b = [...document.querySelectorAll('button')].find(x => x.innerText.includes('wu-tian807'));
  if (b) { b.click(); return 'ok'; }
  return 'no asset';
})()
"""))
time.sleep(3)

# 3. AI dialog
print('3. dialog:', ev("""
(() => {
  const b = [...document.querySelectorAll('button')].find(x => x.innerText.includes('AI 对话'));
  if (b) { b.click(); return 'ok'; }
  return 'no AI btn';
})()
"""))
time.sleep(1.2)

# 4. ask
print('4. ask:', ev("""
(() => {
  const ta = document.querySelector('textarea');
  if (!ta) return 'no textarea';
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, '请简单回应：测试收到你的回答了吗？');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  return 'typed';
})()
"""))
time.sleep(0.4)
print('   send:', ev("""
(() => {
  const dlg = [...document.querySelectorAll('[role=dialog]')].find(d => d.innerText.includes('AI 对话'));
  const send = [...dlg.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '').includes('发送'));
  if (send) { send.click(); return 'sent'; }
  return 'no send';
})()
"""))

# 5. wait for completion (turn takes ~3-5s; wait 15s)
print('5. waiting...')
time.sleep(15)

# 6. check debug dump via main process? No - read the file from shell after.
# Also check dialog text now
print('6. dialog text:', ev("""
(() => {
  const dlg = [...document.querySelectorAll('[role=dialog]')].find(d => d.innerText.includes('AI 对话'));
  if (!dlg) return 'no dialog';
  const texts = [...dlg.querySelectorAll('div, p, span')]
    .filter(el => el.innerText && el.innerText.trim().length > 0 && el.children.length === 0)
    .map(el => el.innerText.trim());
  return JSON.stringify(texts.slice(-10));
})()
"""))

session.close()
