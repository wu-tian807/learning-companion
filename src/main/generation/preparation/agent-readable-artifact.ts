export function isAgentReadableArtifactMediaType(
  mediaType: string,
): boolean {
  const normalized = mediaType.trim().toLowerCase();

  return (
    normalized.startsWith('text/') ||
    normalized.startsWith('image/') ||
    normalized === 'application/pdf' ||
    normalized === 'application/json' ||
    normalized.endsWith('+json') ||
    normalized === 'application/xml' ||
    normalized.endsWith('+xml') ||
    normalized === 'application/x-subrip'
  );
}
