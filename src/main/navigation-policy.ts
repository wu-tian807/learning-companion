export function isAllowedMainWindowNavigation(
  currentUrl: string,
  targetUrl: string,
  devServerUrl?: string,
): boolean {
  try {
    const current = new URL(currentUrl);
    const target = new URL(targetUrl);

    if (target.href === current.href) {
      return true;
    }

    if (!devServerUrl) {
      return false;
    }

    const devServer = new URL(devServerUrl);
    const isHttpDevServer =
      devServer.protocol === 'http:' || devServer.protocol === 'https:';

    return (
      isHttpDevServer &&
      target.protocol === devServer.protocol &&
      target.origin === devServer.origin
    );
  } catch {
    return false;
  }
}
