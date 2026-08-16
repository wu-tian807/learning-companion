import type { AssetTarget } from '../../shared/workbench/anchor';

export const DOCUMENT_AI_IPC_CHANNELS = Object.freeze({
  ask: 'document-ai:ask',
  cancel: 'document-ai:cancel',
});

export interface DocumentAiRequest {
  readonly projectId: string;
  readonly assetId: string;
  readonly requestId: string;
  readonly conversationId: string;
  readonly question: string;
  readonly target: AssetTarget;
  readonly selectedText?: string;
  readonly generateTitle?: boolean;
}

export interface DocumentAiResponse {
  readonly answer: string;
  readonly title?: string;
  readonly providerId: string;
  readonly modelId: string;
}

export interface DocumentAiPreloadApi {
  askDocumentAi(request: DocumentAiRequest): Promise<DocumentAiResponse>;
  cancelDocumentAi(requestId: string): Promise<void>;
}
