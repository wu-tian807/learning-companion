export interface HtmlSourceTextRuntime {
  readRange(range: Range): string;
  readElement(element: Element): string;
  formulaRoot(element: Element): Element | undefined;
}

interface FormulaSource {
  readonly kind: 'tex' | 'mathml';
  readonly value: string;
  readonly display: boolean;
}

/**
 * Creates a self-contained DOM reader that can be serialized into a sandboxed
 * HTML frame. Keep every runtime dependency inside this function.
 */
export function createHtmlSourceTextRuntime(): HtmlSourceTextRuntime {
  const formulaSelector = [
    '.katex',
    'mjx-container',
    '.MathJax_Display',
    '.MathJax',
    'math',
    '[data-tex]',
    '[data-latex]',
  ].join(',');

  function text(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  function isMathTexScript(element: Element | null): element is Element {
    return Boolean(
      element &&
        element.tagName.toLowerCase() === 'script' &&
        text(element.getAttribute('type')).toLowerCase().startsWith('math/tex'),
    );
  }

  function relatedMathTexScript(element: Element): Element | undefined {
    const candidates: Array<Element | null> = [
      element.nextElementSibling,
      element.previousElementSibling,
      element.parentElement?.nextElementSibling ?? null,
      element.parentElement?.previousElementSibling ?? null,
    ];
    const frameId = [element, element.querySelector('[id$="-Frame"]')]
      .map((candidate) => candidate?.id ?? '')
      .find((id) => id.endsWith('-Frame'));
    if (frameId) {
      candidates.push(document.getElementById(frameId.slice(0, -'-Frame'.length)));
    }
    return candidates.find(isMathTexScript) ?? undefined;
  }

  function isDisplayFormula(
    element: Element,
    sourceScript?: Element,
  ): boolean {
    const scriptType = text(sourceScript?.getAttribute('type')).toLowerCase();
    return Boolean(
      element.closest('.katex-display, .MathJax_Display') ||
        (element.matches('mjx-container') &&
          text(element.getAttribute('display')).toLowerCase() === 'true') ||
        (element.matches('math') &&
          text(element.getAttribute('display')).toLowerCase() === 'block') ||
        scriptType.includes('mode=display'),
    );
  }

  function texAnnotation(element: Element): string {
    const annotations = Array.from(element.querySelectorAll('annotation'));
    const annotation = annotations.find((candidate) => {
      const encoding = text(candidate.getAttribute('encoding')).toLowerCase();
      return (
        encoding === 'application/x-tex' ||
        encoding === 'application/tex' ||
        encoding === 'text/x-tex'
      );
    });
    return text(annotation?.textContent);
  }

  function record(value: unknown): Record<string, unknown> | undefined {
    return typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : undefined;
  }

  function mathJaxRuntimeSource(element: Element): FormulaSource | undefined {
    try {
      const mathJax = record(
        (globalThis as unknown as Record<string, unknown>).MathJax,
      );
      const startup = record(mathJax?.startup);
      const mathDocument = record(startup?.document);
      const mathList = mathDocument?.math;
      let items: readonly unknown[] = [];
      if (Array.isArray(mathList)) {
        items = mathList;
      } else {
        const listRecord = record(mathList);
        const toArray = listRecord?.toArray;
        if (typeof toArray === 'function') {
          const array = toArray.call(mathList);
          if (Array.isArray(array)) {
            items = array;
          }
        } else if (
          mathList &&
          typeof (mathList as { [Symbol.iterator]?: unknown })[
            Symbol.iterator
          ] === 'function'
        ) {
          items = Array.from(mathList as Iterable<unknown>);
        }
      }

      for (const itemValue of items) {
        const item = record(itemValue);
        const typesetRoot = item?.typesetRoot;
        let ownsElement = typesetRoot === element;
        if (!ownsElement && typesetRoot instanceof Node) {
          ownsElement = element.contains(typesetRoot);
        }
        const source = text(item?.math) || text(item?.originalText);
        if (ownsElement && source) {
          return {
            kind: 'tex',
            value: source,
            display:
              typeof item?.display === 'boolean'
                ? item.display
                : isDisplayFormula(element),
          };
        }
      }

      const hub = record(mathJax?.Hub);
      const getJaxFor = hub?.getJaxFor;
      if (typeof getJaxFor === 'function') {
        const jax = record(getJaxFor.call(hub, element));
        const source = text(jax?.originalText) || text(jax?.math);
        if (source) {
          return {
            kind: 'tex',
            value: source,
            display: isDisplayFormula(element),
          };
        }
      }
    } catch {
      // A page-owned MathJax object is optional and untrusted.
    }
    return undefined;
  }

  function formulaSource(element: Element): FormulaSource | undefined {
    const attributeSource =
      text(element.getAttribute('data-tex')) ||
      text(element.getAttribute('data-latex'));
    if (attributeSource) {
      return {
        kind: 'tex',
        value: attributeSource,
        display: isDisplayFormula(element),
      };
    }

    const annotationSource = texAnnotation(element);
    if (annotationSource) {
      return {
        kind: 'tex',
        value: annotationSource,
        display: isDisplayFormula(element),
      };
    }

    const runtimeSource = mathJaxRuntimeSource(element);
    if (runtimeSource) {
      return runtimeSource;
    }

    const sourceScript = relatedMathTexScript(element);
    const scriptSource = text(sourceScript?.textContent);
    if (scriptSource) {
      return {
        kind: 'tex',
        value: scriptSource,
        display: isDisplayFormula(element, sourceScript),
      };
    }

    if (element.matches('math')) {
      const altText = text(element.getAttribute('alttext'));
      if (altText) {
        return {
          kind: 'tex',
          value: altText,
          display: isDisplayFormula(element),
        };
      }
      return {
        kind: 'mathml',
        value: element.outerHTML,
        display: isDisplayFormula(element),
      };
    }

    const assistiveMath = element.querySelector('math');
    if (assistiveMath) {
      const assistiveSource = formulaSource(assistiveMath);
      if (assistiveSource) {
        return {
          ...assistiveSource,
          display: isDisplayFormula(element),
        };
      }
    }

    return undefined;
  }

  function hasSourceDelimiters(value: string): boolean {
    return (
      (value.startsWith('$$') && value.endsWith('$$')) ||
      (value.startsWith('$') && value.endsWith('$')) ||
      (value.startsWith('\\(') && value.endsWith('\\)')) ||
      (value.startsWith('\\[') && value.endsWith('\\]'))
    );
  }

  function sourceText(source: FormulaSource): string {
    if (source.kind === 'mathml' || hasSourceDelimiters(source.value)) {
      return source.value;
    }
    return source.display
      ? `$$${source.value}$$`
      : `$${source.value}$`;
  }

  function intersects(range: Range, element: Element): boolean {
    try {
      return range.intersectsNode(element);
    } catch {
      return false;
    }
  }

  function selectedFormulaRoots(
    range: Range,
  ): readonly { readonly element: Element; readonly text: string }[] {
    const commonElement =
      range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
        ? (range.commonAncestorContainer as Element)
        : range.commonAncestorContainer.parentElement;
    if (!commonElement) {
      return [];
    }
    const formulaElements: Element[] = [];
    let ancestor: Element | null = commonElement;
    while (ancestor) {
      if (ancestor.matches(formulaSelector)) {
        formulaElements.unshift(ancestor);
      }
      ancestor = ancestor.parentElement;
    }
    formulaElements.push(
      ...Array.from(commonElement.querySelectorAll(formulaSelector)),
    );
    const seen = new Set<Element>();
    const candidates = formulaElements
      .filter((element) => {
        if (seen.has(element)) {
          return false;
        }
        seen.add(element);
        return true;
      })
      .filter((element) => intersects(range, element))
      .map((element) => ({ element, source: formulaSource(element) }))
      .filter(
        (
          candidate,
        ): candidate is { readonly element: Element; readonly source: FormulaSource } =>
          candidate.source !== undefined,
      );
    const candidateElements = new Set(
      candidates.map((candidate) => candidate.element),
    );

    return candidates
      .filter((candidate) => {
        let parent = candidate.element.parentElement;
        while (parent) {
          if (candidateElements.has(parent)) {
            return false;
          }
          parent = parent.parentElement;
        }
        return true;
      })
      .map(({ element, source }) => ({
        element,
        text: sourceText(source),
      }));
  }

  function rangeBoundaryIsInside(range: Range, element: Element): {
    readonly start: boolean;
    readonly end: boolean;
  } {
    return {
      start:
        range.startContainer === element ||
        element.contains(range.startContainer),
      end:
        range.endContainer === element ||
        element.contains(range.endContainer),
    };
  }

  function readRangeWithFormulaRoots(
    range: Range,
    formulas: ReturnType<typeof selectedFormulaRoots>,
  ): string {
    const remaining = range.cloneRange();
    let output = '';

    for (const formula of formulas) {
      const boundary = rangeBoundaryIsInside(range, formula.element);
      if (!boundary.start) {
        try {
          const prefix = remaining.cloneRange();
          prefix.setEndBefore(formula.element);
          output += prefix.toString();
        } catch {
          return range.toString();
        }
      }

      output += formula.text;
      if (boundary.end) {
        return output;
      }

      try {
        remaining.setStartAfter(formula.element);
      } catch {
        return range.toString();
      }
    }

    return output + remaining.toString();
  }

  function readRange(range: Range): string {
    const formulas = selectedFormulaRoots(range);
    return formulas.length > 0
      ? readRangeWithFormulaRoots(range, formulas)
      : range.toString();
  }

  function readElement(element: Element): string {
    const range = document.createRange();
    range.selectNodeContents(element);
    const formulas = selectedFormulaRoots(range);
    if (formulas.length > 0) {
      return readRangeWithFormulaRoots(range, formulas);
    }
    const innerText =
      'innerText' in element
        ? (element as HTMLElement).innerText
        : undefined;
    return typeof innerText === 'string'
      ? innerText
      : element.textContent ?? '';
  }

  function formulaRoot(element: Element): Element | undefined {
    let current: Element | null = element;
    let outermost: Element | undefined;
    while (current) {
      if (current.matches(formulaSelector) && formulaSource(current)) {
        outermost = current;
      }
      current = current.parentElement;
    }
    return outermost;
  }

  return { readRange, readElement, formulaRoot };
}

export function createHtmlSourceTextRuntimeExpression(): string {
  return `(${createHtmlSourceTextRuntime.toString()})()`;
}
