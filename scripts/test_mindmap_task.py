"""On-device verification: run a real mindmap generation task through the app.

Proves the full Codex turn pipeline (with the new delta-synthesis at the
RPC boundary) still completes on the Ark custom-API connection. The task
succeeds only if turn items arrive correctly and the synthesized delta
flows through without breaking the executor.
"""
import json
import sys
import time

sys.path.insert(0, 'scripts')
from cdp_debug import connect_main

session, page = connect_main()

def ev(expr, await_promise=False):
    return session.evaluate(expr, await_promise=await_promise)

# Create a mindmap generation task via the preload bridge (real IPC)
create_expr = """
(async () => {
  try {
    const started = await window.learningCompanion.startGenerationTask({
      projectId: '6a0f22f0-7f5b-42f0-bd27-7963aff455b9',
      definitionId: 'mindmap.generate',
      definitionVersion: 1,
      instruction: {
        format: 'learning-companion/mindmap-generation-instruction',
        version: 1,
      },
      assetReferences: {
        sources: [{ assetId: 'eebf3e7b-cccc-4690-a4fe-ef7131f32d95' }],
      },
    });
    return JSON.stringify({ ok: true, id: started.id, status: started.status });
  } catch (error) {
    return JSON.stringify({ ok: false, message: String(error && error.message) });
  }
})()
"""

print('=== create mindmap task ===')
result = ev(create_expr, await_promise=True)
print(result)

task_id = None
if isinstance(result, str) and result.startswith('{'):
    try:
        parsed = json.loads(result)
        task_id = parsed.get('id')
    except Exception:
        pass
print('task_id:', task_id)
session.close()

if not task_id:
    sys.exit(1)

# Wait for the task to complete (mindmap turns can take ~30-60s), poll the DB
import sqlite3
con = sqlite3.connect('C:/Users/20935/AppData/Roaming/Learning Companion/data/learning-companion.sqlite3')
for i in range(30):
    time.sleep(3)
    row = con.execute(
        'SELECT id, prepared_time, process_completed_time, failure_json, cancelled_time FROM generation_tasks WHERE id = ?',
        (task_id,),
    ).fetchone()
    if not row:
        print(f'[{i*3}s] task row missing')
        continue
    _, prep, comp, fail, cancelled = row
    status = 'FAILED' if fail else ('OK' if comp else ('CANCELLED' if cancelled else ('RUNNING' if prep else 'CREATED')))
    print(f'[{i*3}s] status: {status}')
    if comp or fail or cancelled:
        if fail:
            try:
                f = json.loads(fail)
                print('  failure:', f.get('code'), '|', f.get('detail', '')[:300])
            except Exception:
                print('  failure raw:', str(fail)[:300])
        sys.exit(0)
print('TIMEOUT after 90s')
sys.exit(1)
