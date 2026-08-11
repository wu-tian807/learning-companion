import type { AssetTarget } from '../../shared/workbench/anchor';

export const DOCUMENT_AI_IPC_CHANNELS = Object.freeze({
  ask: 'document-ai:ask',
});

export interface DocumentAiRequest {
  readonly projectId: string;
  readonly assetId: string;
  readonly conversationId: string;
  readonly question: string;
  readonly target: AssetTarget;
  readonly selectedText?: string;
}

export interface DocumentAiResponse {
  readonly answer: string;
  readonly providerId: string;
  readonly modelId: string;
}

export interface DocumentAiPreloadApi {
  askDocumentAi(request: DocumentAiRequest): Promise<DocumentAiResponse>;
}
