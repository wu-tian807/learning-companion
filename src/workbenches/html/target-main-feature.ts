import type { MainWorkbenchFeatureContribution } from '../../main/workbench/main-workbench-contribution';
import {
  HTML_DOM_ANCHOR_TYPE,
  HTML_DOM_ANCHOR_VERSION,
  HTML_ELEMENT_ANCHOR_TYPE,
  HTML_ELEMENT_ANCHOR_VERSION,
  HTML_LINK_ANCHOR_TYPE,
  HTML_LINK_ANCHOR_VERSION,
  HTML_QUOTE_ANCHOR_TYPE,
  HTML_QUOTE_ANCHOR_VERSION,
  isHtmlDomAnchorV1,
  isHtmlElementAnchorV1,
  isHtmlLinkAnchorV1,
  isHtmlQuoteAnchorV1,
} from './shared';

export const htmlTargetMainFeature = Object.freeze({
  id: 'builtin.html.targets',
  registerAssetTargets({ targets }): void {
    targets.register({
      workbenchId: 'builtin.html',
      targetType: HTML_DOM_ANCHOR_TYPE,
      version: HTML_DOM_ANCHOR_VERSION,
      isPayload: isHtmlDomAnchorV1,
      agent: {
        description: 'HTML DOM 中由元素路径和可读特征共同定位的元素',
        payloadSchema: {
          type: 'object',
          required: ['element'],
          properties: {
            frameUrl: { type: 'string' },
            element: {
              type: 'object',
              required: ['path', 'tagName'],
              properties: {
                path: { type: 'array', items: { type: 'integer', minimum: 0 } },
                tagName: { type: 'string' },
                id: { type: 'string' },
                role: { type: 'string' },
                ariaLabel: { type: 'string' },
                textQuote: { type: 'string' },
              },
            },
          },
        },
        examplePayloads: [{
          element: { path: [1, 0], tagName: 'section', textQuote: '示例内容' },
        }],
      },
      describe(payload): string {
        const element = (payload as { readonly element: { readonly tagName: string; readonly textQuote?: string } }).element;
        return element.textQuote ? `${element.tagName}“${element.textQuote}”` : element.tagName;
      },
    });
    targets.register({
      workbenchId: 'builtin.html',
      targetType: HTML_QUOTE_ANCHOR_TYPE,
      version: HTML_QUOTE_ANCHOR_VERSION,
      isPayload: isHtmlQuoteAnchorV1,
      agent: {
        description: 'HTML 中可由精确原文重新找到的文本',
        payloadSchema: {
          type: 'object',
          required: ['exact'],
          properties: { exact: { type: 'string', minLength: 1 }, frameUrl: { type: 'string' } },
        },
        examplePayloads: [{ exact: '需要定位的原文' }],
      },
      describe(payload): string {
        return `原文“${(payload as { readonly exact: string }).exact}”`;
      },
    });
    targets.register({
      workbenchId: 'builtin.html',
      targetType: HTML_LINK_ANCHOR_TYPE,
      version: HTML_LINK_ANCHOR_VERSION,
      isPayload: isHtmlLinkAnchorV1,
      agent: {
        description: 'HTML 页面中的绝对 HTTP(S) 链接',
        payloadSchema: {
          type: 'object',
          required: ['url'],
          properties: { url: { type: 'string', format: 'uri' } },
        },
        examplePayloads: [{ url: 'https://example.com/' }],
      },
      describe(payload): string {
        return (payload as { readonly url: string }).url;
      },
    });
    targets.register({
      workbenchId: 'builtin.html',
      targetType: HTML_ELEMENT_ANCHOR_TYPE,
      version: HTML_ELEMENT_ANCHOR_VERSION,
      isPayload: isHtmlElementAnchorV1,
      agent: {
        description: '旧版 HTML frame 内由 DOM 路径和矩形共同定位的元素；新生成优先使用 html.dom',
        payloadSchema: {
          type: 'object',
          required: ['frameUrl', 'tagName', 'domPath', 'rect'],
          properties: {
            frameUrl: { type: 'string' },
            tagName: { type: 'string' },
            domPath: { type: 'array', items: { type: 'integer', minimum: 0 } },
            rect: {
              type: 'object',
              required: ['x', 'y', 'width', 'height'],
              properties: {
                x: { type: 'number' },
                y: { type: 'number' },
                width: { type: 'number' },
                height: { type: 'number' },
              },
            },
            textQuote: { type: 'string' },
          },
        },
        examplePayloads: [{
          frameUrl: 'https://example.com/',
          tagName: 'p',
          domPath: [1, 0],
          rect: { x: 0, y: 0, width: 100, height: 20 },
          textQuote: '示例内容',
        }],
      },
      describe(payload): string {
        const value = payload as { readonly tagName: string; readonly textQuote?: string };
        return value.textQuote ? `${value.tagName}“${value.textQuote}”` : value.tagName;
      },
    });
  },
} satisfies MainWorkbenchFeatureContribution);
