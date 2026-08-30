export class ExternalLibraryInstallationAbortError extends Error {
  readonly discardDownloads: boolean;

  constructor(discardDownloads = false) {
    super('External library installation cancelled');
    this.name = 'AbortError';
    this.discardDownloads = discardDownloads;
  }
}

export function isExternalLibraryAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export function externalLibraryAbortReason(
  signal: AbortSignal,
): Error {
  return isExternalLibraryAbortError(signal.reason)
    ? signal.reason
    : new ExternalLibraryInstallationAbortError();
}

export function shouldDiscardExternalLibraryDownloads(
  signal: AbortSignal,
): boolean {
  return (
    signal.reason instanceof ExternalLibraryInstallationAbortError &&
    signal.reason.discardDownloads
  );
}
