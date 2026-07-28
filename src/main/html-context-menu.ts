import type { ContextMenuParams } from 'electron';

import {
  HTML_CONTEXT_SELECTION_MAX_LENGTH,
  type HtmlContextMediaType,
  type HtmlContextMenuEvent,
  htmlContextMediaTypes,
  isOpenExternalRequest,
} from '../shared/ipc';

interface FrameLike {
  readonly url: string;
  readonly parent: FrameLike | null;
}

type HtmlContextMenuParams = Pick<
  ContextMenuParams,
  | 'x'
  | 'y'
  | 'frameURL'
  | 'selectionText'
  | 'linkURL'
  | 'mediaType'
  | 'srcURL'
> & {
  readonly frame: FrameLike | null;
};

function isHtmlContentUrl(value: string): boolean {
  return value.startsWith('learning-content://resource/');
}

function isInsideHtmlWorkbenchFrame(
  initialFrame: FrameLike | null,
): boolean {
  let frame = initialFrame;
  let remainingDepth = 64;

  while (frame && remainingDepth > 0) {
    if (isHtmlContentUrl(frame.url)) {
      return true;
    }

    frame = frame.parent;
    remainingDepth -= 1;
  }

  return false;
}

function externalUrlOrUndefined(value: string): string | undefined {
  return isOpenExternalRequest({ url: value }) ? value : undefined;
}

function contextMediaType(
  value: ContextMenuParams['mediaType'],
): HtmlContextMediaType {
  return htmlContextMediaTypes.includes(
    value as HtmlContextMediaType,
  )
    ? (value as HtmlContextMediaType)
    : 'none';
}

export function createHtmlContextMenuEvent(
  params: HtmlContextMenuParams,
): HtmlContextMenuEvent | undefined {
  if (
    !isInsideHtmlWorkbenchFrame(params.frame) ||
    !Number.isSafeInteger(params.x) ||
    params.x < 0 ||
    !Number.isSafeInteger(params.y) ||
    params.y < 0
  ) {
    return undefined;
  }

  const selectionText = params.selectionText.slice(
    0,
    HTML_CONTEXT_SELECTION_MAX_LENGTH,
  );

  return {
    x: params.x,
    y: params.y,
    frameUrl: params.frameURL || params.frame?.url || 'about:blank',
    ...(selectionText.trim() ? { selectionText } : {}),
    ...(externalUrlOrUndefined(params.linkURL)
      ? { linkUrl: params.linkURL }
      : {}),
    mediaType: contextMediaType(params.mediaType),
    ...(externalUrlOrUndefined(params.srcURL)
      ? { sourceUrl: params.srcURL }
      : {}),
  };
}
