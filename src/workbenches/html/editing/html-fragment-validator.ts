import {
  defaultTreeAdapter,
  html,
  parse,
  parseFragment,
  type DefaultTreeAdapterTypes,
  type ParserError,
} from 'parse5';

import {
  HTML_EDIT_LIMITS,
  HtmlEditError,
  type HtmlEditScope,
} from './html-document-parser';

export interface HtmlFragmentContext {
  readonly tagName: string;
  readonly namespaceURI: string;
}

export interface ValidatedHtmlFragment {
  readonly topLevelElementCount: number;
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

function isElement(
  node: DefaultTreeAdapterTypes.Node,
): node is DefaultTreeAdapterTypes.Element {
  return 'tagName' in node;
}

function childrenOf(
  node: DefaultTreeAdapterTypes.Node,
): readonly DefaultTreeAdapterTypes.ChildNode[] {
  if ('content' in node && node.tagName === 'template') {
    return node.content.childNodes;
  }
  return 'childNodes' in node ? node.childNodes : [];
}

function hasOnlyWhitespaceOutsideElement(
  nodes: readonly DefaultTreeAdapterTypes.ChildNode[],
  element: DefaultTreeAdapterTypes.Element,
): boolean {
  return nodes.every(
    (node) =>
      node === element || ('value' in node && node.value.trim() === ''),
  );
}

function assertExplicitlyClosed(
  node: DefaultTreeAdapterTypes.Node,
  replacement: string,
): void {
  if (isElement(node)) {
    const location = node.sourceCodeLocation;
    if (!location?.startTag) {
      throw new HtmlEditError(
        'REPLACEMENT_REPAIRED',
        'replacement 依赖了 HTML parser 隐式插入的元素',
      );
    }

    const isHtmlVoid =
      node.namespaceURI === html.NS.HTML && HTML_VOID_ELEMENTS.has(node.tagName);
    const rawStartTag = replacement.slice(
      location.startTag.startOffset,
      location.startTag.endOffset,
    );
    const isForeignSelfClosing =
      node.namespaceURI !== html.NS.HTML && /\/\s*>$/.test(rawStartTag);
    if (!isHtmlVoid && !isForeignSelfClosing && !location.endTag) {
      throw new HtmlEditError(
        'REPLACEMENT_NOT_CLOSED',
        `替换区域未闭合：<${node.tagName}> 必须有显式结束标签`,
      );
    }
  }

  for (const child of childrenOf(node)) {
    assertExplicitlyClosed(child, replacement);
  }
}

function assertSourceOrderAndContainment(
  node: DefaultTreeAdapterTypes.Node,
): void {
  let previousOffset = -1;
  const parentLocation = node.sourceCodeLocation;

  for (const child of childrenOf(node)) {
    const location = child.sourceCodeLocation;
    if (location) {
      if (location.startOffset < previousOffset) {
        throw new HtmlEditError(
          'REPLACEMENT_REPAIRED',
          'replacement 触发了 HTML parser 的节点重排',
        );
      }
      if (
        parentLocation &&
        (location.startOffset < parentLocation.startOffset ||
          location.endOffset > parentLocation.endOffset)
      ) {
        throw new HtmlEditError(
          'REPLACEMENT_REPAIRED',
          'replacement 触发了 HTML parser 的上下文修复',
        );
      }
      previousOffset = location.startOffset;
    }
    assertSourceOrderAndContainment(child);
  }
}

function assertSourceCoverage(
  nodes: readonly DefaultTreeAdapterTypes.ChildNode[],
  replacement: string,
): void {
  const ranges = nodes
    .flatMap((node) => {
      const location = node.sourceCodeLocation;
      return location
        ? [{ start: location.startOffset, end: location.endOffset }]
        : [];
    })
    .sort((left, right) => left.start - right.start);
  let coveredUntil = 0;

  for (const range of ranges) {
    if (replacement.slice(coveredUntil, range.start).trim().length > 0) {
      throw new HtmlEditError(
        'REPLACEMENT_REPAIRED',
        'replacement 包含被 HTML parser 忽略或修复的标记',
      );
    }
    coveredUntil = Math.max(coveredUntil, range.end);
  }
  if (replacement.slice(coveredUntil).trim().length > 0) {
    throw new HtmlEditError(
      'REPLACEMENT_REPAIRED',
      'replacement 包含被 HTML parser 忽略或修复的标记',
    );
  }
}

export function validateHtmlFragment(
  replacement: string,
  context: HtmlFragmentContext,
  scope: HtmlEditScope,
): ValidatedHtmlFragment {
  if (replacement.length > HTML_EDIT_LIMITS.replacementLength) {
    throw new HtmlEditError(
      'REPLACEMENT_TOO_LARGE',
      'replacement 超出大小限制',
    );
  }

  const namespace = Object.values(html.NS).includes(context.namespaceURI as html.NS)
    ? (context.namespaceURI as html.NS)
    : html.NS.HTML;
  const errors: ParserError[] = [];
  const fragment =
    context.tagName === '#document'
      ? parse(replacement, {
          sourceCodeLocationInfo: true,
          onParseError: (error) => {
            if (error.code !== 'missing-doctype') errors.push(error);
          },
        })
      : parseFragment(
          defaultTreeAdapter.createElement(context.tagName, namespace, []),
          replacement,
          {
            sourceCodeLocationInfo: true,
            onParseError: (error) => errors.push(error),
          },
        );

  if (errors.length > 0) {
    throw new HtmlEditError(
      'REPLACEMENT_PARSE_ERROR',
      `replacement HTML 无效：${errors[0].code}`,
    );
  }

  const topLevelElements = fragment.childNodes.filter(isElement);
  if (
    scope === 'element' &&
    (topLevelElements.length !== 1 ||
      !hasOnlyWhitespaceOutsideElement(fragment.childNodes, topLevelElements[0]))
  ) {
    throw new HtmlEditError(
      'REPLACEMENT_SCOPE_INVALID',
      'element scope 的 replacement 必须只包含一个顶层元素，顶层外只允许空白',
    );
  }

  assertExplicitlyClosed(fragment, replacement);
  assertSourceOrderAndContainment(fragment);
  assertSourceCoverage(fragment.childNodes, replacement);

  return { topLevelElementCount: topLevelElements.length };
}
