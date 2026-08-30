import type { EpubExplanationView } from './explanations/shared';
import { assignEpubExplanationLanes } from './explanations/epub-explanation-lanes';
import type { EpubReadingNoteView } from './notes/shared';
import { epubAnnotationWaveStyles } from './epub-annotation-wave';

export interface EpubAnnotationApi {
  underline(
    cfiRange: string,
    data: Record<string, string>,
    callback: () => void,
    className: string,
    styles: Readonly<Record<string, string>>,
  ): unknown;
  highlight(
    cfiRange: string,
    data: Record<string, string>,
    callback: () => void,
    className: string,
    styles: Readonly<Record<string, string>>,
  ): unknown;
  remove(cfiRange: string, type: 'underline' | 'highlight'): void;
}

export function renderEpubAnnotationWaves(
  annotations: EpubAnnotationApi,
  explanations: readonly EpubExplanationView[],
  readingNotes: readonly EpubReadingNoteView[],
  handlers: {
    readonly onExplanationClick: (explanation: EpubExplanationView) => void;
    readonly onNoteClick: (note: EpubReadingNoteView) => void;
  },
): () => void {
  const lanes = assignEpubExplanationLanes([
    ...explanations.map((explanation) => ({
      id: `explanation:${explanation.id}`,
      cfiRange: explanation.target.anchorPayload.cfiRange,
    })),
    ...readingNotes.map((note) => ({
      id: `note:${note.id}`,
      cfiRange: note.target.anchorPayload.cfiRange,
    })),
  ]);

  for (const explanation of explanations) {
    annotations.underline(
      explanation.target.anchorPayload.cfiRange,
      { explanationId: explanation.id },
      () => handlers.onExplanationClick(explanation),
      `epub-ai-explanation-${explanation.status}`,
      epubAnnotationWaveStyles(
        lanes[`explanation:${explanation.id}`] ?? 0,
        explanation.markerColor ?? 'blue',
        'rect',
      ),
    );
  }

  for (const note of readingNotes) {
    annotations.highlight(
      note.target.anchorPayload.cfiRange,
      { readingNoteId: note.id },
      () => handlers.onNoteClick(note),
      'epub-authored-reading-note',
      {
        ...epubAnnotationWaveStyles(
          lanes[`note:${note.id}`] ?? 0,
          note.markerColor,
          'rect',
        ),
        fill: 'none',
        'fill-opacity': '0',
      },
    );
  }

  return () => {
    for (const explanation of explanations) {
      annotations.remove(
        explanation.target.anchorPayload.cfiRange,
        'underline',
      );
    }
    for (const note of readingNotes) {
      annotations.remove(
        note.target.anchorPayload.cfiRange,
        'highlight',
      );
    }
  };
}
