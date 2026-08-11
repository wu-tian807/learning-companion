"""Open the test project via UI, then create a generation task via preload."""
import json
import sys
import time

sys.path.insert(0, 'scripts')
from cdp_debug import connect_main

session, page = connect_main()

def ev(expr, await_promise=False):
    return session.evaluate(expr, await_promise=await_promise)

# Open the 'test' project by clicking its card
print('=== open test project ===')
print(ev("""
(() => {
  const buttons = [...document.querySelectorAll('button, [role=button]')];
  const card = buttons.find(b => b.innerText.includes('test') && b.innerText.includes('Asset'));
  if (card) { card.click(); return 'clicked card: ' + card.innerText.slice(0, 60); }
  return 'no card: ' + buttons.map(b => b.innerText.slice(0, 20)).join('|');
})()
"""))
time.sleep(2.5)
print('URL now:', ev('location.href'))
print('BODY:', ev('document.body.innerText.slice(0, 200)'))

# Now create the task — the project context should be active
create_expr = """
(async () => {
  const lc = window.learningCompanion;
  try {
    const started = await lc.startGenerationTask({
      projectId: '6a0f22f0-7f5b-42f0-bd27-7963aff455b9',
      definitionId: 'html.assistant',
      definitionVersion: 1,
      instruction: {
        format: 'learning-companion/html-assistant-instruction',
        version: 1,
        question: '用一句话回答：这个页面讲的是什么？（连通性测试）',
      },
      assetReferences: {
        sources: [{ assetId: 'eebf3e7b-cccc-4690-a4fe-ef7131f32d95' }],
      },
    });
    return 'OK: ' + JSON.stringify(started).slice(0, 500);
  } catch (error) {
    const detail = {};
    for (const key of Object.keys(error || {})) {
      try { detail[key] = String(error[key]); } catch {}
    }
    return 'ERR: name=' + (error && error.name) + ' message=' + (error && error.message) + ' detail=' + JSON.stringify(detail).slice(0, 600);
  }
})()
"""

print('\n=== create generation task ===')
result = ev(create_expr, await_promise=True)
print(result)

session.close()
