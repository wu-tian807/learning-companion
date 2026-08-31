import type { HtmlDomAnchorV1 } from '../shared';
import {
  createHtmlDomAnchor,
  findElementAtDomPath,
  findElementAtSourceOffset,
  HTML_EDIT_LIMITS,
  HtmlSourceEditError,
  parseHtmlDocument,
  resolveHtmlEditTarget,
  type HtmlEditLocator,
} from './html-document-parser';
import {
  validateHtmlFragment,
  type HtmlEditScope,
} from './html-fragment-validator';

export {
  HTML_EDIT_LIMITS,
  HtmlSourceEditError,
  type HtmlEditLocator,
  type HtmlSourceEditErrorCode,
} from './html-document-parser';

export interface BegunHtmlSourceEdit {
  readonly source: string;
  readonly scope: HtmlEditScope;
  readonly range: { readonly start: number; readonly end: number };
  readonly currentHtml: string;
  readonly resolvedTarget: HtmlDomAnchorV1;
  readonly context: {
    readonly tagName: string;
    readonly namespaceURI: string;
  };
}

export function beginHtmlSourceEdit(request: {
  readonly source: string;
  readonly locator: HtmlEditLocator;
  readonly scope: HtmlEditScope;
}): BegunHtmlSourceEdit {
  const parsed = parseHtmlDocument(request.source);
  const target = resolveHtmlEditTarget(parsed, request.locator, request.scope);
  return {
    source: request.source,
    scope: request.scope,
    range: target.range,
    currentHtml: target.currentHtml,
    resolvedTarget: target.anchor,
    context: target.context,
  };
}

export function replaceHtmlSourceEdit(
  edit: BegunHtmlSourceEdit,
  replacement: string,
): { readonly source: string; readonly resolvedTarget: HtmlDomAnchorV1 } {
  if (replacement.length > HTML_EDIT_LIMITS.replacementLength) {
    throw new HtmlSourceEditError('REGION_TOO_LARGE', 'replacement 超出大小限制');
  }
  validateHtmlFragment(replacement, edit.context, edit.scope);
  const source =
    edit.source.slice(0, edit.range.start) +
    replacement +
    edit.source.slice(edit.range.end);
  const parsed = parseHtmlDocument(source);
  const target =
    edit.scope === 'contents'
      ? findElementAtDomPath(parsed, edit.resolvedTarget.element.path)
      : findElementAtSourceOffset(
          parsed,
          edit.range.start +
            (replacement.length - replacement.trimStart().length),
        );
  if (!target) {
    throw new HtmlSourceEditError(
      'TARGET_NOT_FOUND',
      '替换后的目标元素无法重新定位',
    );
  }
  return {
    source,
    resolvedTarget: createHtmlDomAnchor(
      parsed,
      target,
      edit.resolvedTarget.frameUrl,
    ),
  };
}
