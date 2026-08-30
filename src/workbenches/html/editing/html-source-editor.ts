import type { HtmlDomAnchorV1 } from '../shared';
import {
  createHtmlDomAnchor,
  findElementAtDomPath,
  findElementAtSourceOffset,
  HTML_EDIT_LIMITS,
  HtmlEditError,
  parseHtmlDocument,
  resolveHtmlEditTarget,
  type HtmlEditLocator,
  type HtmlEditScope,
  type HtmlSourceRange,
} from './html-document-parser';
import { validateHtmlFragment } from './html-fragment-validator';

export interface BeginHtmlSourceEditRequest {
  readonly source: string;
  readonly locator: HtmlEditLocator;
  readonly scope: HtmlEditScope;
}

export interface BegunHtmlSourceEdit {
  readonly source: string;
  readonly scope: HtmlEditScope;
  readonly range: HtmlSourceRange;
  readonly currentHtml: string;
  readonly resolvedTarget: HtmlDomAnchorV1;
  readonly context: {
    readonly tagName: string;
    readonly namespaceURI: string;
  };
}

export interface ReplaceHtmlSourceEditRequest {
  readonly edit: BegunHtmlSourceEdit;
  readonly replacement: string;
}

export interface ReplacedHtmlSourceEdit {
  readonly source: string;
  readonly resolvedTarget: HtmlDomAnchorV1;
}

export function beginHtmlSourceEdit(
  request: BeginHtmlSourceEditRequest,
): BegunHtmlSourceEdit {
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
  request: ReplaceHtmlSourceEditRequest,
): ReplacedHtmlSourceEdit {
  const { edit, replacement } = request;
  if (replacement.length > HTML_EDIT_LIMITS.replacementLength) {
    throw new HtmlEditError(
      'REPLACEMENT_TOO_LARGE',
      'replacement 超出大小限制',
    );
  }

  validateHtmlFragment(replacement, edit.context, edit.scope);
  const source =
    edit.source.slice(0, edit.range.start) +
    replacement +
    edit.source.slice(edit.range.end);
  if (source.length > HTML_EDIT_LIMITS.documentLength) {
    throw new HtmlEditError('DOCUMENT_TOO_LARGE', '替换后的 HTML 文档超出大小限制');
  }

  const parsed = parseHtmlDocument(source);
  let target: Element | undefined;
  if (edit.scope === 'contents') {
    target = findElementAtDomPath(parsed, edit.resolvedTarget.element.path);
  } else {
    const leadingWhitespaceLength =
      replacement.length - replacement.trimStart().length;
    target = findElementAtSourceOffset(
      parsed,
      edit.range.start + leadingWhitespaceLength,
    );
  }

  if (!target) {
    throw new HtmlEditError(
      'DOCUMENT_PARSE_ERROR',
      '替换后的目标元素无法从完整文档中重新定位',
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
