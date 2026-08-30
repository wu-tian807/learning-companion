import {
  parse,
  type DefaultTreeAdapterTypes,
} from 'parse5';

import type { HtmlDomAnchorV1 } from '../shared';
import {
  validateHtmlFragment,
  type HtmlEditScope,
} from './html-fragment-validator';

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

interface CompoundSelector {
  readonly tagName?: string;
  readonly id?: string;
  readonly classes: readonly string[];
  readonly attributes: readonly {
    readonly name: string;
    readonly value?: string;
  }[];
  readonly nthChild?: number;
  readonly nthOfType?: number;
}

interface SelectorPart {
  readonly compound: CompoundSelector;
  readonly relationToPrevious?: 'child' | 'descendant';
}

type Element = DefaultTreeAdapterTypes.Element;
type Node = DefaultTreeAdapterTypes.Node;
type ParentNode = DefaultTreeAdapterTypes.ParentNode;

function isElement(node: Node): node is Element {
  return 'tagName' in node;
}

function elementChildren(node: ParentNode): readonly Element[] {
  return node.childNodes.filter(isElement);
}

function parentElement(element: Element): Element | undefined {
  return element.parentNode && isElement(element.parentNode)
    ? element.parentNode
    : undefined;
}

function allElements(root: ParentNode): Element[] {
  const result: Element[] = [];
  const visit = (parent: ParentNode): void => {
    for (const child of parent.childNodes) {
      if (!isElement(child)) continue;
      result.push(child);
      visit(child);
      if ('content' in child && child.tagName === 'template') {
        visit(child.content);
      }
    }
  };
  visit(root);
  return result;
}

function attribute(element: Element, name: string): string | undefined {
  return element.attrs.find(
    (candidate) => candidate.name.toLowerCase() === name.toLowerCase(),
  )?.value;
}

function textContent(node: ParentNode): string {
  let text = '';
  for (const child of node.childNodes) {
    if ('value' in child) text += child.value;
    else if (isElement(child)) {
      text += textContent(
        'content' in child && child.tagName === 'template'
          ? child.content
          : child,
      );
    }
  }
  return text;
}

function normalizedText(element: Element): string | undefined {
  const text = textContent(element).replace(/\s+/gu, ' ').trim().slice(0, 1_024);
  return text || undefined;
}

function parseIdentifier(
  source: string,
  start: number,
): { readonly value: string; readonly end: number } | undefined {
  const match = /^[A-Za-z_][A-Za-z0-9_-]*/u.exec(source.slice(start));
  return match ? { value: match[0], end: start + match[0].length } : undefined;
}

function parseCompound(source: string): CompoundSelector | undefined {
  let index = 0;
  let tagName: string | undefined;
  if (source[index] === '*') {
    index += 1;
  } else {
    const tag = parseIdentifier(source, index);
    if (tag) {
      tagName = tag.value.toLowerCase();
      index = tag.end;
    }
  }
  let id: string | undefined;
  const classes: string[] = [];
  const attributes: Array<{ name: string; value?: string }> = [];
  let nthChild: number | undefined;
  let nthOfType: number | undefined;

  while (index < source.length) {
    const prefix = source[index];
    if (prefix === '#' || prefix === '.') {
      const parsed = parseIdentifier(source, index + 1);
      if (!parsed) return undefined;
      if (prefix === '#') {
        if (id !== undefined) return undefined;
        id = parsed.value;
      } else {
        classes.push(parsed.value);
      }
      index = parsed.end;
      continue;
    }
    if (prefix === '[') {
      const end = source.indexOf(']', index + 1);
      if (end < 0) return undefined;
      const body = source.slice(index + 1, end).trim();
      const match =
        /^([A-Za-z_][A-Za-z0-9_:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"']+)))?$/u.exec(
          body,
        );
      if (!match) return undefined;
      const value = match[2] ?? match[3] ?? match[4];
      attributes.push({
        name: match[1]!.toLowerCase(),
        ...(value !== undefined ? { value } : {}),
      });
      index = end + 1;
      continue;
    }
    if (prefix === ':') {
      const pseudo = /^:(nth-child|nth-of-type)\(\s*([1-9][0-9]*)\s*\)/u.exec(
        source.slice(index),
      );
      if (!pseudo) return undefined;
      const position = Number(pseudo[2]);
      if (!Number.isSafeInteger(position)) return undefined;
      if (pseudo[1] === 'nth-child') nthChild = position;
      else nthOfType = position;
      index += pseudo[0].length;
      continue;
    }
    return undefined;
  }

  if (
    tagName === undefined &&
    id === undefined &&
    classes.length === 0 &&
    attributes.length === 0 &&
    nthChild === undefined &&
    nthOfType === undefined
  ) {
    return undefined;
  }
  return { tagName, id, classes, attributes, nthChild, nthOfType };
}

function tokenizeSelector(selector: string): readonly SelectorPart[] | undefined {
  const parts: SelectorPart[] = [];
  let index = 0;
  let relation: SelectorPart['relationToPrevious'];

  while (index < selector.length) {
    let hadWhitespace = false;
    while (/\s/u.test(selector[index] ?? '')) {
      hadWhitespace = true;
      index += 1;
    }
    if (index >= selector.length) break;
    if (parts.length > 0) {
      if (selector[index] === '>') {
        relation = 'child';
        index += 1;
        while (/\s/u.test(selector[index] ?? '')) index += 1;
      } else if (hadWhitespace) {
        relation = 'descendant';
      } else {
        return undefined;
      }
    }

    const start = index;
    let quote: string | undefined;
    let bracketDepth = 0;
    while (index < selector.length) {
      const character = selector[index]!;
      if (quote) {
        if (character === quote) quote = undefined;
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === '[' || character === '(') {
        bracketDepth += 1;
      } else if (character === ']' || character === ')') {
        bracketDepth -= 1;
        if (bracketDepth < 0) return undefined;
      } else if (bracketDepth === 0 && (character === '>' || /\s/u.test(character))) {
        break;
      }
      index += 1;
    }
    if (quote || bracketDepth !== 0) return undefined;
    const compound = parseCompound(selector.slice(start, index));
    if (!compound) return undefined;
    parts.push({ compound, ...(parts.length > 0 ? { relationToPrevious: relation } : {}) });
    relation = undefined;
  }
  return parts.length > 0 && relation === undefined ? parts : undefined;
}

function matchesCompound(element: Element, selector: CompoundSelector): boolean {
  if (selector.tagName && element.tagName.toLowerCase() !== selector.tagName) {
    return false;
  }
  if (selector.id && attribute(element, 'id') !== selector.id) return false;
  const classNames = new Set((attribute(element, 'class') ?? '').split(/\s+/u));
  if (selector.classes.some((name) => !classNames.has(name))) return false;
  if (
    selector.attributes.some((expected) => {
      const actual = attribute(element, expected.name);
      return actual === undefined ||
        (expected.value !== undefined && actual !== expected.value);
    })
  ) {
    return false;
  }
  const parent = parentElement(element);
  if (selector.nthChild !== undefined) {
    if (!parent || elementChildren(parent).indexOf(element) + 1 !== selector.nthChild) {
      return false;
    }
  }
  if (selector.nthOfType !== undefined) {
    if (
      !parent ||
      elementChildren(parent)
        .filter((child) => child.tagName === element.tagName)
        .indexOf(element) +
        1 !==
        selector.nthOfType
    ) {
      return false;
    }
  }
  return true;
}

function matchesSelector(
  element: Element,
  parts: readonly SelectorPart[],
  index = parts.length - 1,
): boolean {
  const part = parts[index];
  if (!part || !matchesCompound(element, part.compound)) return false;
  if (index === 0) return true;

  if (part.relationToPrevious === 'child') {
    const parent = parentElement(element);
    return parent ? matchesSelector(parent, parts, index - 1) : false;
  }
  let ancestor = parentElement(element);
  while (ancestor) {
    if (matchesSelector(ancestor, parts, index - 1)) return true;
    ancestor = parentElement(ancestor);
  }
  return false;
}

function documentElement(document: DefaultTreeAdapterTypes.Document): Element {
  const root = elementChildren(document).find((element) => element.tagName === 'html');
  if (!root) throw new HtmlSourceEditError('TARGET_NOT_FOUND', 'HTML 文档没有根元素');
  return root;
}

function elementPath(root: Element, element: Element): readonly number[] {
  if (element === root) return [];
  const path: number[] = [];
  let current: Element | undefined = element;
  while (current && current !== root) {
    const parent = parentElement(current);
    if (!parent) {
      throw new HtmlSourceEditError('TARGET_HAS_NO_SOURCE', '目标不在文档元素树中');
    }
    const index = elementChildren(parent).indexOf(current);
    if (index < 0) {
      throw new HtmlSourceEditError('TARGET_HAS_NO_SOURCE', '目标 DOM path 无效');
    }
    path.unshift(index);
    current = parent;
  }
  if (current !== root) {
    throw new HtmlSourceEditError('TARGET_HAS_NO_SOURCE', '目标不在文档元素树中');
  }
  return path;
}

function elementAtPath(root: Element, path: readonly number[]): Element | undefined {
  let current: Element | undefined = root;
  for (const index of path) current = current ? elementChildren(current)[index] : undefined;
  return current;
}

function anchorFor(
  document: DefaultTreeAdapterTypes.Document,
  element: Element,
  frameUrl: string,
): HtmlDomAnchorV1 {
  const id = attribute(element, 'id');
  const role = attribute(element, 'role');
  const ariaLabel = attribute(element, 'aria-label');
  const quote = normalizedText(element);
  return {
    frameUrl,
    element: {
      path: elementPath(documentElement(document), element),
      tagName: element.tagName.toLowerCase(),
      ...(id ? { id } : {}),
      ...(role ? { role } : {}),
      ...(ariaLabel ? { ariaLabel } : {}),
      ...(quote ? { textQuote: quote } : {}),
    },
  };
}

function assertAnchorFingerprint(element: Element, anchor: HtmlDomAnchorV1): void {
  const actual = {
    tagName: element.tagName.toLowerCase(),
    id: attribute(element, 'id'),
    role: attribute(element, 'role'),
    ariaLabel: attribute(element, 'aria-label'),
    textQuote: normalizedText(element),
  };
  const expected = anchor.element;
  if (
    actual.tagName !== expected.tagName ||
    (expected.id !== undefined && actual.id !== expected.id) ||
    (expected.role !== undefined && actual.role !== expected.role) ||
    (expected.ariaLabel !== undefined && actual.ariaLabel !== expected.ariaLabel) ||
    (expected.textQuote !== undefined && actual.textQuote !== expected.textQuote)
  ) {
    throw new HtmlSourceEditError('ANCHOR_MISMATCH', 'DOM Anchor 指纹已变化');
  }
}

function parseDocument(source: string): DefaultTreeAdapterTypes.Document {
  if (source.length > HTML_EDIT_LIMITS.documentLength) {
    throw new HtmlSourceEditError('DOCUMENT_TOO_LARGE', 'HTML 文档超出大小限制');
  }
  return parse(source, { sourceCodeLocationInfo: true });
}

export function beginHtmlSourceEdit(request: {
  readonly source: string;
  readonly locator: HtmlEditLocator;
  readonly scope: HtmlEditScope;
}): BegunHtmlSourceEdit {
  const document = parseDocument(request.source);
  let element: Element | undefined;
  let frameUrl = 'about:blank';

  if (request.locator.kind === 'selector') {
    const selector = request.locator.selector;
    if (!selector.trim()) {
      throw new HtmlSourceEditError('SELECTOR_EMPTY', 'selector 不能为空');
    }
    if (selector.length > HTML_EDIT_LIMITS.selectorLength) {
      throw new HtmlSourceEditError('SELECTOR_TOO_LARGE', 'selector 超出大小限制');
    }
    const parsedSelector = tokenizeSelector(selector.trim());
    if (!parsedSelector) {
      throw new HtmlSourceEditError('SELECTOR_INVALID', 'selector 语法无效');
    }
    const matches = allElements(document).filter((candidate) =>
      matchesSelector(candidate, parsedSelector),
    );
    if (matches.length === 0) {
      throw new HtmlSourceEditError('TARGET_NOT_FOUND', 'selector 没有匹配元素');
    }
    if (matches.length !== 1) {
      throw new HtmlSourceEditError('TARGET_NOT_UNIQUE', 'selector 必须唯一匹配一个元素');
    }
    element = matches[0];
  } else {
    frameUrl = request.locator.anchor.frameUrl;
    element = elementAtPath(
      documentElement(document),
      request.locator.anchor.element.path,
    );
    if (!element) {
      throw new HtmlSourceEditError('TARGET_NOT_FOUND', 'DOM Anchor path 不存在');
    }
    assertAnchorFingerprint(element, request.locator.anchor);
  }

  const location = element.sourceCodeLocation;
  if (!location?.startTag) {
    throw new HtmlSourceEditError('TARGET_HAS_NO_SOURCE', '目标元素没有真实源码位置');
  }
  const range =
    request.scope === 'element'
      ? { start: location.startOffset, end: location.endOffset }
      : location.endTag
        ? { start: location.startTag.endOffset, end: location.endTag.startOffset }
        : undefined;
  if (!range) {
    throw new HtmlSourceEditError('TARGET_HAS_NO_SOURCE', '目标元素没有显式闭合区域');
  }
  if (range.end - range.start > HTML_EDIT_LIMITS.regionLength) {
    throw new HtmlSourceEditError('REGION_TOO_LARGE', '目标区域超出大小限制');
  }
  const parent = request.scope === 'contents' ? element : parentElement(element);
  return {
    source: request.source,
    scope: request.scope,
    range,
    currentHtml: request.source.slice(range.start, range.end),
    resolvedTarget: anchorFor(document, element, frameUrl),
    context: {
      tagName: parent?.tagName.toLowerCase() ?? '#document',
      namespaceURI:
        parent?.namespaceURI ?? 'http://www.w3.org/1999/xhtml',
    },
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
  const document = parseDocument(source);
  let target: Element | undefined;
  if (edit.scope === 'contents') {
    target = elementAtPath(
      documentElement(document),
      edit.resolvedTarget.element.path,
    );
  } else {
    const expectedOffset =
      edit.range.start + (replacement.length - replacement.trimStart().length);
    target = allElements(document).find(
      (element) => element.sourceCodeLocation?.startOffset === expectedOffset,
    );
  }
  if (!target) {
    throw new HtmlSourceEditError(
      'TARGET_NOT_FOUND',
      '替换后的目标元素无法重新定位',
    );
  }
  return {
    source,
    resolvedTarget: anchorFor(document, target, edit.resolvedTarget.frameUrl),
  };
}
