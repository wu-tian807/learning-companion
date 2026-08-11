"""Reproduce stuck model dropdown - step 6: switch back to Responses API, then RE-SELECT the same connection.

The user's repro: with the connection already set to 'Responses-compatible API',
re-picking it from the dropdown leaves the model dropdown stuck at
'正在读取模型…' forever.
"""
import sys
import time

sys.path.insert(0, 'scripts')
from cdp_debug import connect_main

session, page = connect_main()

def ev(expr):
    return session.evaluate(expr)

def selector_state(tag):
    s = ev(f"""
    (() => {{
      const section = [...document.querySelectorAll('section')].find(s => s.innerText.includes('生成思维导图、学习提纲等 Project 内容'));
      if (!section) return null;
      const input = section.querySelector('input[aria-label="生成中心 模型"]');
      const connBtn = [...section.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === '生成中心 Connection');
      const effortBtn = [...section.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === '生成中心 思考力度');
      const applyBtn = [...section.querySelectorAll('button')].find(b => b.textContent.trim() === '应用');
      return {{
        conn: connBtn?.innerText?.trim(),
        modelValue: input?.value,
        modelPlaceholder: input?.placeholder,
        modelDisabled: input?.disabled,
        effort: effortBtn?.innerText?.trim(),
        applyDisabled: applyBtn?.disabled,
      }};
    }})()
    """)
    print(f'[{tag}]', s)

def open_conn_dropdown():
    return ev("""
    (() => {
      const section = [...document.querySelectorAll('section')].find(s => s.innerText.includes('生成思维导图、学习提纲等 Project 内容'));
      const btn = [...section.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === '生成中心 Connection');
      btn.click();
      return 'opened';
    })()
    """)

def click_conn_option(label_part):
    return ev(f"""
    (() => {{
      const items = [...document.querySelectorAll('[role=option], [class*=option]')];
      const target = items.find(el => el.innerText.includes('{label_part}'));
      if (target) {{ target.click(); return 'clicked'; }}
      return 'not found: ' + items.map(i => i.innerText).join('|');
    }})()
    """)

selector_state('baseline (currently ChatGPT account)')

# Step 1: switch back to Responses-compatible API (normal path, loads doubao)
print('\n=== switch to Responses-compatible API (normal path) ===')
open_conn_dropdown()
time.sleep(0.5)
print(click_conn_option('Responses-compatible API'))
for i in range(3):
    time.sleep(1.0)
    selector_state(f'switch t+{i+1}s')

# Step 2: THE BUG PATH - re-open dropdown, re-select the SAME connection
print('\n=== BUG PATH: re-select "Responses-compatible API" (same as current) ===')
open_conn_dropdown()
time.sleep(0.5)
print(click_conn_option('Responses-compatible API'))
for i in range(8):
    time.sleep(1.0)
    selector_state(f'reselect t+{i+1}s')

session.close()
