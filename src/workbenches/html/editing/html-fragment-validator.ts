import {
  defaultTreeAdapter,
  html,
  parse,
  parseFragment,
  type DefaultTreeAdapterTypes,
  type ParserError,
} from 'parse5';

export type HtmlEditScope = 'contents' | 'element';

export class HtmlEditValidationError extends Error {
  constructor(
    readonly code:
      | 'REPLACEMENT_NOT_CLOSED'
      | 'REPLACEMENT_PARSE_ERROR'
      | 'REPLACEMENT_REPAIRED'
      | 'REPLACEMENT_SCOPE_INVALID',
    message: string,
  ) {
    super(message);
    this.name = 'HtmlEditValidationError';
  }
}

interface HtmlFragmentContext {
  readonly tagName: string;
  readonly namespaceURI: string;
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

function assertExplicitlyClosed(
  node: DefaultTreeAdapterTypes.Node,
  replacement: string,
): void {
  if (isElement(node)) {
    const location = node.sourceCodeLocation;
    if (!location?.startTag) {
      throw new HtmlEditValidationError(
        'REPLACEMENT_REPAIRED',
        'replacement 依赖了 HTML parser 隐式插入的元素',
      );
    }
    const isVoid =
      node.namespaceURI === html.NS.HTML && HTML_VOID_ELEMENTS.has(node.tagName);
    const rawStartTag = replacement.slice(
      location.startTag.startOffset,
      location.startTag.endOffset,
    );
    const isForeignSelfClosing =
      node.namespaceURI !== html.NS.HTML && /\/\s*>$/u.test(rawStartTag);
    if (!isVoid && !isForeignSelfClosing && !location.endTag) {
      throw new HtmlEditValidationError(
        'REPLACEMENT_NOT_CLOSED',
        `替换区域未闭合：<${node.tagName}> 必须有显式结束标签`,
      );
    }
  }
  for (const child of childrenOf(node)) {
    assertExplicitlyClosed(child, replacement);
  }
}

function assertSourceOrder(node: DefaultTreeAdapterTypes.Node): void {
  let previousOffset = -1;
  const parentLocation = node.sourceCodeLocation;
  for (const child of childrenOf(node)) {
    const location = child.sourceCodeLocation;
    if (location) {
      if (
        location.startOffset < previousOffset ||
        (parentLocation &&
          (location.startOffset < parentLocation.startOffset ||
            location.endOffset > parentLocation.endOffset))
      ) {
        throw new HtmlEditValidationError(
          'REPLACEMENT_REPAIRED',
          'replacement 触发了 HTML parser 的节点重排或上下文修复',
        );
      }
      previousOffset = location.startOffset;
    }
    assertSourceOrder(child);
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
    if (replacement.slice(coveredUntil, range.start).trim()) {
      throw new HtmlEditValidationError(
        'REPLACEMENT_REPAIRED',
        'replacement 包含被 HTML parser 忽略或修复的标记',
      );
    }
    coveredUntil = Math.max(coveredUntil, range.end);
  }
  if (replacement.slice(coveredUntil).trim()) {
    throw new HtmlEditValidationError(
      'REPLACEMENT_REPAIRED',
      'replacement 包含被 HTML parser 忽略或修复的标记',
    );
  }
}

export function validateHtmlFragment(
  replacement: string,
  context: HtmlFragmentContext,
  scope: HtmlEditScope,
): void {
  const namespace = Object.values(html.NS).includes(
    context.namespaceURI as html.NS,
  )
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
    throw new HtmlEditValidationError(
      'REPLACEMENT_PARSE_ERROR',
      `replacement HTML 无效：${errors[0]!.code}`,
    );
  }

  const topLevelElements = fragment.childNodes.filter(isElement);
  if (
    scope === 'element' &&
    (topLevelElements.length !== 1 ||
      !fragment.childNodes.every(
        (node) =>
          node === topLevelElements[0] ||
          ('value' in node && node.value.trim() === ''),
      ))
  ) {
    throw new HtmlEditValidationError(
      'REPLACEMENT_SCOPE_INVALID',
      'element scope 的 replacement 必须只包含一个顶层元素',
    );
  }
  assertExplicitlyClosed(fragment, replacement);
  assertSourceOrder(fragment);
  assertSourceCoverage(fragment.childNodes, replacement);
}
