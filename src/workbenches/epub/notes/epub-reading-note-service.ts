import type { AssetLookup } from '../../../main/assets/asset-database';
import type { AttachmentServiceApi } from '../../../main/attachments/attachment-service';
import { AppError } from '../../../main/errors/app-error';
import type { AssetAttachment } from '../../../shared/attachments/contracts';
import {
  EPUB_READING_NOTE_ATTACHMENT_TYPE,
  EPUB_READING_NOTE_ATTACHMENT_VERSION,
  createEpubReadingNoteMetadata,
  toEpubReadingNoteView,
  type CreateEpubReadingNoteRequest,
  type DeleteEpubReadingNoteRequest,
  type EpubReadingNoteScopeRequest,
  type EpubReadingNoteView,
  type UpdateEpubReadingNoteRequest,
} from './shared';

export interface EpubReadingNoteServiceApi {
  create(request: CreateEpubReadingNoteRequest): Promise<EpubReadingNoteView>;
  update(request: UpdateEpubReadingNoteRequest): Promise<EpubReadingNoteView>;
  delete(request: DeleteEpubReadingNoteRequest): Promise<void>;
}

export class EpubReadingNoteService implements EpubReadingNoteServiceApi {
  constructor(
    private readonly attachments: AttachmentServiceApi,
    private readonly assets: AssetLookup,
  ) {}

  async create(
    request: CreateEpubReadingNoteRequest,
  ): Promise<EpubReadingNoteView> {
    const scope = this.requireAsset(request);
    const created = await this.attachments.create({
      ...scope,
      typeId: EPUB_READING_NOTE_ATTACHMENT_TYPE,
      typeVersion: EPUB_READING_NOTE_ATTACHMENT_VERSION,
      target: request.target,
      metadata: createEpubReadingNoteMetadata(
        request.text,
        request.markerColor,
      ),
    });
    return this.requireView(created, scope);
  }

  async update(
    request: UpdateEpubReadingNoteRequest,
  ): Promise<EpubReadingNoteView> {
    const current = await this.requireNote(request, request.noteId);
    const updated = await this.attachments.update({
      projectId: current.projectId,
      attachmentId: current.id,
      metadata: createEpubReadingNoteMetadata(
        request.text,
        request.markerColor,
      ),
    });
    return this.requireView(updated, request);
  }

  async delete(request: DeleteEpubReadingNoteRequest): Promise<void> {
    const current = await this.requireNote(request, request.noteId);
    await this.attachments.delete(current.projectId, current.id);
  }

  private requireAsset(
    request: EpubReadingNoteScopeRequest,
  ): EpubReadingNoteScopeRequest {
    const projectId = request.projectId.trim();
    const assetId = request.assetId.trim();
    const asset = this.assets.get(projectId, assetId);
    if (!asset || asset.mediaType !== 'application/epub+zip') {
      throw new AppError('ASSET_NOT_FOUND');
    }
    return { projectId, assetId };
  }

  private async requireNote(
    request: EpubReadingNoteScopeRequest,
    noteId: string,
  ): Promise<EpubReadingNoteView> {
    const scope = this.requireAsset(request);
    const attachment = await this.attachments.get(noteId.trim());
    if (!attachment) {
      throw new AppError('ATTACHMENT_NOT_FOUND');
    }
    return this.requireView(attachment, scope);
  }

  private requireView(
    attachment: AssetAttachment,
    scope: EpubReadingNoteScopeRequest,
  ): EpubReadingNoteView {
    const view = toEpubReadingNoteView(attachment);
    if (
      !view ||
      view.projectId !== scope.projectId.trim() ||
      view.assetId !== scope.assetId.trim()
    ) {
      throw new AppError('ATTACHMENT_NOT_FOUND');
    }
    return view;
  }
}
