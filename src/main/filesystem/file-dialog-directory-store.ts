export interface FileDialogDirectoryStoreApi {
  get(scope: string): string | undefined;
  remember(scope: string, directoryPath: string): void;
}

export class InMemoryFileDialogDirectoryStore
  implements FileDialogDirectoryStoreApi
{
  private readonly directories = new Map<string, string>();

  get(scope: string): string | undefined {
    return this.directories.get(scope);
  }

  remember(scope: string, directoryPath: string): void {
    this.directories.set(scope, directoryPath);
  }
}
