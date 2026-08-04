export interface FileDialogLastDirectoryCacheApi {
  get(scope: string): string | undefined;
  remember(scope: string, directoryPath: string): void;
}

export class InMemoryFileDialogLastDirectoryCache
  implements FileDialogLastDirectoryCacheApi
{
  private readonly directories = new Map<string, string>();

  get(scope: string): string | undefined {
    return this.directories.get(scope);
  }

  remember(scope: string, directoryPath: string): void {
    this.directories.set(scope, directoryPath);
  }
}
