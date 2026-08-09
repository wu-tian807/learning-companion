const RESPONSES_PATH_SEGMENT = 'responses';

function normalizedPathname(url: URL): string {
  const pathname = url.pathname.replace(/\/+$/u, '');
  return pathname || '/';
}

function endsWithResponses(pathname: string): boolean {
  return (
    pathname.split('/').filter(Boolean).at(-1)?.toLowerCase() ===
    RESPONSES_PATH_SEGMENT
  );
}

function serializeWithoutTrailingSlash(url: URL): string {
  return url.toString().replace(/\/$/u, '');
}

/**
 * Codex model_provider.base_url expects the API root. Accept a full Responses
 * endpoint from the user, but remove its final `/responses` segment before the
 * value reaches Codex so the runtime can append the wire endpoint itself.
 */
export function normalizeCodexResponsesBaseUrl(value: string): string {
  const url = new URL(value.trim());
  const pathname = normalizedPathname(url);

  if (endsWithResponses(pathname)) {
    const segments = pathname.split('/').filter(Boolean);
    segments.pop();
    url.pathname = segments.length > 0 ? `/${segments.join('/')}` : '/';
  } else {
    url.pathname = pathname;
  }

  return serializeWithoutTrailingSlash(url);
}

/** Resolve the concrete endpoint used only for reachability probing. */
export function resolveCodexResponsesEndpointUrl(value: string): string {
  const url = new URL(value.trim());
  const pathname = normalizedPathname(url);

  url.pathname = endsWithResponses(pathname)
    ? pathname
    : `${pathname === '/' ? '' : pathname}/${RESPONSES_PATH_SEGMENT}`;

  return serializeWithoutTrailingSlash(url);
}
