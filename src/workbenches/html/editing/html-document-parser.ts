import { selectAll, type Options } from 'css-select';
import { parse, type DefaultTreeAdapterTypes, type Token } from 'parse5';

import type { HtmlDomAnchorV1, HtmlDomElementV1 } from '../shared';
import type { HtmlEditScope } from './html-fragment-validator';

export const HTML_EDIT_LIMITS = Object.freeze({
  selectorLength: 2_048,
  replacementLength: 1_048_576,
  documentLength: 8_388_608,
  regionLength: 2_097_152,
});

export type HtmlEditLocator =
  | { readonly kind: 'selector'; readonly selector: string }
  | { readonly kind: 'dom-anchor'; readonly anchor: HtmlDomAnchorV1 };

export type HtmlSourceEditErrorCode =
  | 'DOCUMENT_TOO_LARGE'
  | 'SELECTOR_EMPTY'
  | 'SELECTOR_TOO_LARGE'
  | 'SELECTOR_INVALID'
  | 'TARGET_NOT_FOUND'
  | 'TARGET_NOT_UNIQUE'
  | 'TARGET_HAS_NO_SOURCE'
  | 'ANCHOR_MISMATCH'
  | 'REGION_TOO_LARGE';

export class HtmlSourceEditError extends Error {
  constructor(
    readonly code: HtmlSourceEditErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'HtmlSourceEditError';
  }
}

type HtmlNode = DefaultTreeAdapterTypes.Node;
type HtmlElement = DefaultTreeAdapterTypes.Element;
type HtmlDocument = DefaultTreeAdapterTypes.Document;

export interface ParsedHtmlDocument {
  readonly document: HtmlDocument;
  readonly source: string;
}

export interface ResolvedHtmlEditTarget {
  readonly anchor: HtmlDomAnchorV1;
  readonly range: { readonly start: number; readonly end: number };
  readonly currentHtml: string;
  readonly context: {
    readonly tagName: string;
    readonly namespaceURI: string;
  };
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

function isElement(node: HtmlNode): node is HtmlElement {
  return 'tagName' in node;
}

function childNodes(node: HtmlNode): HtmlNode[] {
  return 'childNodes' in node ? [...node.childNodes] : [];
}

function elementChildren(node: HtmlNode): HtmlElement[] {
  return childNodes(node).filter(isElement);
}

function parentNode(node: HtmlNode): HtmlNode | null {
  return 'parentNode' in node ? node.parentNode : null;
}

function parentElement(element: HtmlElement): HtmlElement | undefined {
  const parent = element.parentNode;
  return parent && isElement(parent) ? parent : undefined;
}

function attribute(
  element: HtmlElement,
  name: string,
): string | undefined {
  return element.attrs.find(
    (candidate) => candidate.name.toLowerCase() === name.toLowerCase(),
  )?.value;
}

function textContent(node: HtmlNode): string {
  if ('value' in node) return node.value;
  return childNodes(node).map(textContent).join('');
}

function removeSubsets(nodes: HtmlNode[]): HtmlNode[] {
  const unique = [...new Set(nodes)];
  const candidates = new Set(unique);
  return unique.filter((node) => {
    let current = parentNode(node);
    while (current) {
      if (candidates.has(current)) return false;
      current = parentNode(current);
    }
    return true;
  });
}

const selectorAdapter: NonNullable<
  Options<HtmlNode, HtmlElement>['adapter']
> = {
  isTag: isElement,
  getAttributeValue: attribute,
  getChildren: childNodes,
  getName: (element) => element.tagName.toLowerCase(),
  getParent: (element) => element.parentNode,
  getSiblings: (node) => {
    const parent = parentNode(node);
    return parent ? childNodes(parent) : [node];
  },
  getText: textContent,
  hasAttrib: (element, name) => attribute(element, name) !== undefined,
  removeSubsets,
  equals: (left, right) => left === right,
};

function allElements(root: HtmlNode): HtmlElement[] {
  const result: HtmlElement[] = [];
  const visit = (node: HtmlNode): void => {
    for (const child of childNodes(node)) {
      if (!isElement(child)) continue;
      result.push(child);
      visit(child);
    }
  };
  visit(root);
  return result;
}

function documentElement(document: HtmlDocument): HtmlElement {
  const root = elementChildren(document).find(
    (element) => element.tagName === 'html',
  );
  if (!root) {
    throw new HtmlSourceEditError(
      'TARGET_NOT_FOUND',
      'HTML 文档没有根元素',
    );
  }
  return root;
}

function boundedFingerprint(
  value: string | null | undefined,
  limit: number,
): string | undefined {
  const normalized = value?.replace(/\s+/gu, ' ').trim() ?? '';
  return normalized ? normalized.slice(0, limit) : undefined;
}

function elementPath(
  element: HtmlElement,
  document: HtmlDocument,
): readonly number[] {
  const root = documentElement(document);
  const path: number[] = [];
  let current = element;
  while (current !== root) {
    const parent = parentElement(current);
    if (!parent || path.length >= 128) {
      throw new HtmlSourceEditError(
        'TARGET_HAS_NO_SOURCE',
        '目标 DOM path 无效',
      );
    }
    const index = elementChildren(parent).indexOf(current);
    if (index < 0) {
      throw new HtmlSourceEditError(
        'TARGET_HAS_NO_SOURCE',
        '目标 DOM path 无效',
      );
    }
    path.unshift(index);
    current = parent;
  }
  return path;
}

function createAnchor(
  element: HtmlElement,
  document: HtmlDocument,
  frameUrl?: string,
): HtmlDomAnchorV1 {
  const fingerprint: HtmlDomElementV1 = {
    path: elementPath(element, document),
    tagName: element.tagName.toLowerCase(),
    ...(boundedFingerprint(attribute(element, 'id'), 512)
      ? { id: boundedFingerprint(attribute(element, 'id'), 512) }
      : {}),
    ...(boundedFingerprint(attribute(element, 'role'), 128)
      ? { role: boundedFingerprint(attribute(element, 'role'), 128) }
      : {}),
    ...(boundedFingerprint(attribute(element, 'aria-label'), 512)
      ? {
          ariaLabel: boundedFingerprint(
            attribute(element, 'aria-label'),
            512,
          ),
        }
      : {}),
    ...(boundedFingerprint(textContent(element), 1_024)
      ? { textQuote: boundedFingerprint(textContent(element), 1_024) }
      : {}),
  };
  return {
    ...(frameUrl === undefined ? {} : { frameUrl }),
    element: fingerprint,
  };
}

function resolveBySelector(
  document: HtmlDocument,
  selector: string,
): HtmlElement {
  if (selector.trim().length === 0) {
    throw new HtmlSourceEditError('SELECTOR_EMPTY', 'selector 不能为空');
  }
  if (selector.length > HTML_EDIT_LIMITS.selectorLength) {
    throw new HtmlSourceEditError(
      'SELECTOR_TOO_LARGE',
      'selector 超出大小限制',
    );
  }

  let matches: HtmlElement[];
  try {
    matches = selectAll<HtmlNode, HtmlElement>(selector, document, {
      adapter: selectorAdapter,
      xmlMode: false,
    });
  } catch {
    throw new HtmlSourceEditError(
      'SELECTOR_INVALID',
      'selector 语法无效',
    );
  }
  if (matches.length === 0) {
    throw new HtmlSourceEditError(
      'TARGET_NOT_FOUND',
      'selector 没有匹配元素',
    );
  }
  if (matches.length !== 1) {
    throw new HtmlSourceEditError(
      'TARGET_NOT_UNIQUE',
      'selector 必须唯一匹配一个元素',
    );
  }
  return matches[0]!;
}

function resolveByAnchor(
  document: HtmlDocument,
  anchor: HtmlDomAnchorV1,
): HtmlElement {
  let current: HtmlElement | undefined = documentElement(document);
  for (const index of anchor.element.path) {
    if (!Number.isSafeInteger(index) || index < 0 || index > 100_000) {
      throw new HtmlSourceEditError(
        'TARGET_NOT_FOUND',
        'DOM Anchor path 不存在',
      );
    }
    current = current ? elementChildren(current)[index] : undefined;
    if (!current) {
      throw new HtmlSourceEditError(
        'TARGET_NOT_FOUND',
        'DOM Anchor path 不存在',
      );
    }
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
    throw new HtmlSourceEditError(
      'ANCHOR_MISMATCH',
      'DOM Anchor 指纹已变化',
    );
  }
  return current;
}

function sourceLocation(
  element: HtmlElement,
): Token.ElementLocation & { readonly startTag: Token.Location } {
  const location = element.sourceCodeLocation;
  if (!location?.startTag) {
    throw new HtmlSourceEditError(
      'TARGET_HAS_NO_SOURCE',
      '目标元素没有真实源码位置',
    );
  }
  return location as Token.ElementLocation & {
    readonly startTag: Token.Location;
  };
}

export function parseHtmlDocument(source: string): ParsedHtmlDocument {
  if (source.length > HTML_EDIT_LIMITS.documentLength) {
    throw new HtmlSourceEditError(
      'DOCUMENT_TOO_LARGE',
      'HTML 文档超出大小限制',
    );
  }
  try {
    return {
      document: parse(source, { sourceCodeLocationInfo: true }),
      source,
    };
  } catch {
    throw new HtmlSourceEditError(
      'TARGET_HAS_NO_SOURCE',
      'HTML 文档无法解析',
    );
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
  const location = sourceLocation(element);

  let range: { readonly start: number; readonly end: number };
  if (scope === 'element') {
    range = { start: location.startOffset, end: location.endOffset };
  } else {
    if (
      element.namespaceURI === 'http://www.w3.org/1999/xhtml' &&
      HTML_VOID_ELEMENTS.has(element.tagName.toLowerCase())
    ) {
      throw new HtmlSourceEditError(
        'TARGET_HAS_NO_SOURCE',
        'void 元素不支持 contents scope',
      );
    }
    if (!location.endTag) {
      throw new HtmlSourceEditError(
        'TARGET_HAS_NO_SOURCE',
        '目标元素没有显式闭合区域',
      );
    }
    range = {
      start: location.startTag.endOffset,
      end: location.endTag.startOffset,
    };
  }

  if (
    range.start < 0 ||
    range.end < range.start ||
    range.end > parsed.source.length
  ) {
    throw new HtmlSourceEditError(
      'TARGET_HAS_NO_SOURCE',
      '目标源码区间无效',
    );
  }
  if (range.end - range.start > HTML_EDIT_LIMITS.regionLength) {
    throw new HtmlSourceEditError(
      'REGION_TOO_LARGE',
      '目标区域超出大小限制',
    );
  }

  const contextElement = scope === 'contents' ? element : parentElement(element);
  const replacingDocumentElement =
    scope === 'element' && element === documentElement(parsed.document);
  if (!contextElement && !replacingDocumentElement) {
    throw new HtmlSourceEditError(
      'TARGET_HAS_NO_SOURCE',
      '目标元素缺少父级上下文',
    );
  }
  const frameUrl =
    locator.kind === 'dom-anchor' ? locator.anchor.frameUrl : undefined;
  return {
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
): HtmlElement | undefined {
  let current: HtmlElement | undefined = documentElement(parsed.document);
  for (const index of path) {
    current = current ? elementChildren(current)[index] : undefined;
    if (!current) return undefined;
  }
  return current;
}

export function findElementAtSourceOffset(
  parsed: ParsedHtmlDocument,
  offset: number,
): HtmlElement | undefined {
  return allElements(parsed.document).find(
    (element) => element.sourceCodeLocation?.startTag?.startOffset === offset,
  );
}

export function createHtmlDomAnchor(
  parsed: ParsedHtmlDocument,
  element: HtmlElement,
  frameUrl?: string,
): HtmlDomAnchorV1 {
  sourceLocation(element);
  return createAnchor(element, parsed.document, frameUrl);
}
