import type { JsonValue } from '../../../../shared/workbench/protocol';

export interface ManagedJsonContentRepository {
  get(contentId: string): Promise<JsonValue | undefined>;
  set(contentId: string, value: JsonValue): Promise<void>;
}
