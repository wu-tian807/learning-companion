import { JSDOM } from 'jsdom';
import type { Token } from 'parse5';

import type { HtmlDomAnchorV1, HtmlDomElementV1 } from '../shared';

export const HTML_EDIT_LIMITS = {
  selectorLength: 4_096,
  replacementLength: 1_048_576,
  regionLength: 2_097_152,
  documentLength: 10_485_760,
} as const;

export type HtmlEditScope = 'contents' | 'element';

export type HtmlEditLocator =
  | {
      readonly kind: 'selector';
      readonly selector: string;
    }
  | {
      readonly kind: 'dom-anchor';
      readonly anchor: HtmlDomAnchorV1;
    };

export type HtmlEditErrorCode =
  | 'DOCUMENT_TOO_LARGE'
  | 'SELECTOR_EMPTY'
  | 'SELECTOR_TOO_LARGE'
  | 'SELECTOR_INVALID'
  | 'TARGET_NOT_FOUND'
  | 'TARGET_NOT_UNIQUE'
  | 'ANCHOR_INVALID'
  | 'ANCHOR_MISMATCH'
  | 'TARGET_HAS_NO_SOURCE'
  | 'TARGET_REGION_TOO_LARGE'
  | 'VOID_CONTENTS_UNSUPPORTED'
  | 'REPLACEMENT_TOO_LARGE'
  | 'REPLACEMENT_SCOPE_INVALID'
  | 'REPLACEMENT_NOT_CLOSED'
  | 'REPLACEMENT_PARSE_ERROR'
  | 'REPLACEMENT_REPAIRED'
  | 'DOCUMENT_PARSE_ERROR';

export class HtmlEditError extends Error {
  constructor(
    readonly code: HtmlEditErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'HtmlEditError';
  }
}

export interface HtmlSourceRange {
  readonly start: number;
  readonly end: number;
}

export interface ResolvedHtmlEditTarget {
  readonly element: Element;
  readonly anchor: HtmlDomAnchorV1;
  readonly range: HtmlSourceRange;
  readonly currentHtml: string;
  readonly context: {
    readonly tagName: string;
    readonly namespaceURI: string;
  };
}

export interface ParsedHtmlDocument {
  readonly dom: JSDOM;
  readonly document: Document;
  readonly source: string;
}

const HTML_VOID_ELEMENTS = new Set([
  'area',
  'base',
  'basefont',
  'bgsound',
  'br',
  'col',
  'embed',
  'frame',
  'hr',
  'img',
  'input',
  'keygen',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

function boundedFingerprint(value: string | null | undefined, limit: number) {
  const normalized = value?.replace(/\s+/g, ' ').trim() ?? '';
  return normalized ? normalized.slice(0, limit) : undefined;
}

function elementPath(element: Element, document: Document): readonly number[] {
  const path: number[] = [];
  let current = element;

  while (current !== document.documentElement) {
    const parent = current.parentElement;
    if (!parent || path.length >= 128) {
      throw new HtmlEditError('ANCHOR_INVALID', '目标 DOM path 无效');
    }
    const index = Array.prototype.indexOf.call(parent.children, current) as number;
    if (index < 0) {
      throw new HtmlEditError('ANCHOR_INVALID', '目标 DOM path 无效');
    }
    path.unshift(index);
    current = parent;
  }

  return path;
}

function createAnchor(
  element: Element,
  document: Document,
  frameUrl: string,
): HtmlDomAnchorV1 {
  const fingerprint: HtmlDomElementV1 = {
    path: elementPath(element, document),
    tagName: element.tagName.toLowerCase(),
    ...(boundedFingerprint(element.id, 512)
      ? { id: boundedFingerprint(element.id, 512) }
      : {}),
    ...(boundedFingerprint(element.getAttribute('role'), 128)
      ? { role: boundedFingerprint(element.getAttribute('role'), 128) }
      : {}),
    ...(boundedFingerprint(element.getAttribute('aria-label'), 512)
      ? {
          ariaLabel: boundedFingerprint(
            element.getAttribute('aria-label'),
            512,
          ),
        }
      : {}),
    ...(boundedFingerprint(element.textContent, 1_024)
      ? { textQuote: boundedFingerprint(element.textContent, 1_024) }
      : {}),
  };

  return { frameUrl, element: fingerprint };
}

function resolveBySelector(document: Document, selector: string): Element {
  if (selector.trim().length === 0) {
    throw new HtmlEditError('SELECTOR_EMPTY', 'CSS selector 不能为空');
  }
  if (selector.length > HTML_EDIT_LIMITS.selectorLength) {
    throw new HtmlEditError('SELECTOR_TOO_LARGE', 'CSS selector 超出长度限制');
  }

  let matches: NodeListOf<Element>;
  try {
    matches = document.querySelectorAll(selector);
  } catch {
    throw new HtmlEditError('SELECTOR_INVALID', 'CSS selector 无效');
  }

  if (matches.length === 0) {
    throw new HtmlEditError('TARGET_NOT_FOUND', 'CSS selector 未找到元素');
  }
  if (matches.length !== 1) {
    throw new HtmlEditError('TARGET_NOT_UNIQUE', 'CSS selector 必须唯一命中一个元素');
  }
  return matches[0];
}

function resolveByAnchor(document: Document, anchor: HtmlDomAnchorV1): Element {
  let current: Element | undefined = document.documentElement;
  for (const index of anchor.element.path) {
    if (!Number.isSafeInteger(index) || index < 0 || index > 100_000) {
      throw new HtmlEditError('ANCHOR_INVALID', 'DOM Anchor path 无效');
    }
    current = current?.children.item(index) ?? undefined;
    if (!current) {
      throw new HtmlEditError('TARGET_NOT_FOUND', 'DOM Anchor 指向的元素不存在');
    }
  }

  if (!current) {
    throw new HtmlEditError('TARGET_NOT_FOUND', 'DOM Anchor 指向的元素不存在');
  }

  const expected = anchor.element;
  const actual = createAnchor(current, document, anchor.frameUrl).element;
  const fingerprints: ReadonlyArray<keyof HtmlDomElementV1> = [
    'tagName',
    'id',
    'role',
    'ariaLabel',
    'textQuote',
  ];
  if (fingerprints.some((key) => expected[key] !== actual[key])) {
    throw new HtmlEditError('ANCHOR_MISMATCH', 'DOM Anchor 指纹与当前元素不一致');
  }

  return current;
}

function sourceLocation(
  parsed: ParsedHtmlDocument,
  element: Element,
): Token.ElementLocation & { readonly startTag: Token.Location } {
  const location = parsed.dom.nodeLocation(element) as
    | Token.ElementLocation
    | null
    | undefined;
  if (!location?.startTag) {
    throw new HtmlEditError(
      'TARGET_HAS_NO_SOURCE',
      '目标元素由 HTML parser 隐式生成，没有可编辑源码',
    );
  }
  return location as Token.ElementLocation & { readonly startTag: Token.Location };
}

export function parseHtmlDocument(source: string): ParsedHtmlDocument {
  if (source.length > HTML_EDIT_LIMITS.documentLength) {
    throw new HtmlEditError('DOCUMENT_TOO_LARGE', 'HTML 文档超出大小限制');
  }

  try {
    const dom = new JSDOM(source, {
      includeNodeLocations: true,
      contentType: 'text/html',
    });
    return { dom, document: dom.window.document, source };
  } catch {
    throw new HtmlEditError('DOCUMENT_PARSE_ERROR', 'HTML 文档无法解析');
  }
}

export function resolveHtmlEditTarget(
  parsed: ParsedHtmlDocument,
  locator: HtmlEditLocator,
  scope: HtmlEditScope,
): ResolvedHtmlEditTarget {
  const element =
    locator.kind === 'selector'
      ? resolveBySelector(parsed.document, locator.selector)
      : resolveByAnchor(parsed.document, locator.anchor);
  const location = sourceLocation(parsed, element);

  let range: HtmlSourceRange;
  if (scope === 'element') {
    range = { start: location.startOffset, end: location.endOffset };
  } else {
    if (
      element.namespaceURI === 'http://www.w3.org/1999/xhtml' &&
      HTML_VOID_ELEMENTS.has(element.tagName.toLowerCase())
    ) {
      throw new HtmlEditError(
        'VOID_CONTENTS_UNSUPPORTED',
        'void 元素不支持 contents scope',
      );
    }
    const startTag = location.startTag;
    const endTag = location.endTag;
    if (!endTag) {
      throw new HtmlEditError(
        'TARGET_HAS_NO_SOURCE',
        '目标元素没有显式结束标签，无法冻结 contents scope',
      );
    }
    range = {
      start: startTag.endOffset,
      end: endTag.startOffset,
    };
  }

  if (
    range.start < 0 ||
    range.end < range.start ||
    range.end > parsed.source.length
  ) {
    throw new HtmlEditError('TARGET_HAS_NO_SOURCE', '目标源码区间无效');
  }
  if (range.end - range.start > HTML_EDIT_LIMITS.regionLength) {
    throw new HtmlEditError(
      'TARGET_REGION_TOO_LARGE',
      '目标源码区域超出大小限制，请选择更小的元素',
    );
  }

  const contextElement = scope === 'contents' ? element : element.parentElement;
  const isDocumentElementReplacement =
    scope === 'element' && element === parsed.document.documentElement;
  if (!contextElement && !isDocumentElementReplacement) {
    throw new HtmlEditError('TARGET_HAS_NO_SOURCE', '目标元素缺少可解析的父级上下文');
  }
  const frameUrl =
    locator.kind === 'dom-anchor' ? locator.anchor.frameUrl : 'about:blank';

  return {
    element,
    anchor: createAnchor(element, parsed.document, frameUrl),
    range,
    currentHtml: parsed.source.slice(range.start, range.end),
    context: {
      tagName: contextElement?.tagName.toLowerCase() ?? '#document',
      namespaceURI:
        contextElement?.namespaceURI ?? 'http://www.w3.org/1999/xhtml',
    },
  };
}

export function findElementAtDomPath(
  parsed: ParsedHtmlDocument,
  path: readonly number[],
): Element | undefined {
  let current: Element | undefined = parsed.document.documentElement;
  for (const index of path) {
    current = current?.children.item(index) ?? undefined;
    if (!current) {
      return undefined;
    }
  }
  return current;
}

export function findElementAtSourceOffset(
  parsed: ParsedHtmlDocument,
  offset: number,
): Element | undefined {
  return Array.from(parsed.document.querySelectorAll('*')).find((element) => {
    const location = parsed.dom.nodeLocation(element) as
      | Token.ElementLocation
      | null
      | undefined;
    return location?.startTag?.startOffset === offset;
  });
}

export function createHtmlDomAnchor(
  parsed: ParsedHtmlDocument,
  element: Element,
  frameUrl: string,
): HtmlDomAnchorV1 {
  sourceLocation(parsed, element);
  return createAnchor(element, parsed.document, frameUrl);
}
