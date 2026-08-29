import {
  createHtmlSourceTextRuntimeExpression,
  type HtmlSourceTextRuntime,
} from './html-source-text-frame-script';
import type { JsonValue } from '../../shared/workbench/protocol';

type SourceCopyInstallResult = JsonValue & {
  readonly installed: true;
};

function installHtmlSourceCopy(
  sourceText: HtmlSourceTextRuntime,
): SourceCopyInstallResult {
  const stateKey = '__learningCompanionHtmlSourceCopyV1';
  const root = globalThis as unknown as Record<string, unknown>;
  type RuntimeState = { cleanup(): void };
  const existing = root[stateKey] as RuntimeState | undefined;
  if (existing && typeof existing.cleanup === 'function') {
    try {
      existing.cleanup();
    } catch {
      // Page-owned globals are untrusted; installation must still proceed.
    }
  }

  const onCopy = (event: ClipboardEvent) => {
    const selection = globalThis.getSelection?.();
    if (
      !selection ||
      selection.isCollapsed ||
      selection.rangeCount === 0 ||
      !event.clipboardData
    ) {
      return;
    }
    const parts: string[] = [];
    for (let index = 0; index < selection.rangeCount; index += 1) {
      parts.push(sourceText.readRange(selection.getRangeAt(index)));
    }
    const copiedText = parts.join('\n');
    if (!copiedText || copiedText === selection.toString()) {
      return;
    }

    event.clipboardData.clearData();
    event.clipboardData.setData('text/plain', copiedText);
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const state: RuntimeState = {
    cleanup() {
      globalThis.removeEventListener('copy', onCopy, true);
      if (root[stateKey] === state) {
        delete root[stateKey];
      }
    },
  };
  root[stateKey] = state;
  globalThis.addEventListener('copy', onCopy, true);
  return { installed: true };
}

export function createHtmlSourceCopyInstallFrameScript(): string {
  return `(${installHtmlSourceCopy.toString()})(${createHtmlSourceTextRuntimeExpression()})`;
}

export function createHtmlSourceCopyInstallerExpression(): string {
  return `(${installHtmlSourceCopy.toString()})`;
}

export function isHtmlSourceCopyInstallResult(
  value: unknown,
): value is SourceCopyInstallResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    (value as { readonly installed?: unknown }).installed === true
  );
}
