const EPUB_CONTENT_CSP = [
  "default-src 'none'",
  "script-src 'none'",
  "connect-src 'none'",
  "img-src data: blob:",
  "media-src data: blob:",
  "style-src 'unsafe-inline' blob:",
  "font-src data: blob:",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self' blob:",
  "form-action 'none'",
].join('; ');

export function isExternalNetworkUrl(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized.startsWith('http://') ||
    normalized.startsWith('https://') ||
    normalized.startsWith('//')
  );
}

export function toSafeExternalUrl(value: string): string | undefined {
  const normalized = value.trim().startsWith('//')
    ? `https:${value.trim()}`
    : value.trim();

  try {
    const url = new URL(normalized);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.username.length === 0 &&
      url.password.length === 0
    )
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

export function hasExplicitUrlScheme(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(value.trim());
}

function unwrapForms(document: Document): void {
  for (const form of Array.from(document.querySelectorAll('form'))) {
    form.replaceWith(...Array.from(form.childNodes));
  }
}

export function secureEpubDocument(document: Document): void {
  const head = document.querySelector('head');

  for (const existing of document.querySelectorAll(
    'meta[http-equiv="Content-Security-Policy" i], meta[http-equiv="refresh" i]',
  )) {
    existing.remove();
  }
  if (head) {
    const policy = document.createElement('meta');
    policy.setAttribute('http-equiv', 'Content-Security-Policy');
    policy.setAttribute('content', EPUB_CONTENT_CSP);
    head.prepend(policy);
  }

  for (const element of document.querySelectorAll(
    'script, iframe, frame, frameset, object, embed, applet',
  )) {
    element.remove();
  }
  unwrapForms(document);
  for (const control of document.querySelectorAll(
    'input, button, textarea, select, option',
  )) {
    control.remove();
  }

  for (const element of document.querySelectorAll('*')) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value;

      if (
        name.startsWith('on') ||
        name === 'srcdoc' ||
        name === 'formaction' ||
        name === 'ping' ||
        name === 'autofocus'
      ) {
        element.removeAttribute(attribute.name);
        continue;
      }

      if (
        (name === 'src' ||
          name === 'poster' ||
          name === 'data' ||
          name === 'xlink:href') &&
        isExternalNetworkUrl(value)
      ) {
        element.removeAttribute(attribute.name);
      }

      if (
        name === 'style' &&
        /url\s*\(\s*['"]?(?:https?:)?\/\//i.test(value)
      ) {
        element.removeAttribute(attribute.name);
      }
    }

    if (element.localName.toLowerCase() === 'a') {
      element.removeAttribute('target');
      element.removeAttribute('download');
    }
  }

  for (const image of document.querySelectorAll('img, source')) {
    image.removeAttribute('srcset');
  }
  for (const link of document.querySelectorAll('link[href]')) {
    if (isExternalNetworkUrl(link.getAttribute('href') ?? '')) {
      link.remove();
    }
  }
}
