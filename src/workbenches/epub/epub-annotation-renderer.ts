import type { EpubExplanationView } from './explanations/shared';
import { assignEpubExplanationLanes } from './explanations/epub-explanation-lanes';
import type { EpubReadingNoteView } from './notes/shared';
import { epubAnnotationWaveStyles } from './epub-annotation-wave';
import type { LearningNoteSourceMark } from '../../renderer/workbench/renderer-workbench-registry';
import {
  isEpubCfiRangeTarget,
  type EpubCfiRangeTarget,
} from './shared';

type EpubLearningNoteSourceMark = Omit<LearningNoteSourceMark, 'target'> & {
  readonly target: EpubCfiRangeTarget;
};

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
  learningNoteSourceMarks: readonly LearningNoteSourceMark[],
  handlers: {
    readonly onExplanationClick: (explanation: EpubExplanationView) => void;
    readonly onNoteClick: (note: EpubReadingNoteView) => void;
  },
): () => void {
  const supportedLearningNoteMarks = learningNoteSourceMarks.filter(
    (mark): mark is EpubLearningNoteSourceMark =>
      isEpubCfiRangeTarget(mark.target),
  );
  const occupiedAnnotationTypes = new Map<string, Set<'underline' | 'highlight'>>();
  for (const explanation of explanations) {
    const cfiRange = explanation.target.targetPayload.cfiRange;
    const types = occupiedAnnotationTypes.get(cfiRange) ?? new Set();
    types.add('underline');
    occupiedAnnotationTypes.set(cfiRange, types);
  }
  for (const note of readingNotes) {
    const cfiRange = note.target.targetPayload.cfiRange;
    const types = occupiedAnnotationTypes.get(cfiRange) ?? new Set();
    types.add('highlight');
    occupiedAnnotationTypes.set(cfiRange, types);
  }
  const renderedLearningNoteMarks: Array<{
    readonly mark: EpubLearningNoteSourceMark;
    readonly annotationType: 'underline' | 'highlight';
  }> = [];
  const seenLearningNoteCfis = new Set<string>();
  for (const mark of supportedLearningNoteMarks) {
    const cfiRange = mark.target.targetPayload.cfiRange;
    if (seenLearningNoteCfis.has(cfiRange)) continue;
    seenLearningNoteCfis.add(cfiRange);
    const occupied = occupiedAnnotationTypes.get(cfiRange) ?? new Set();
    const annotationType = !occupied.has('underline')
      ? 'underline'
      : !occupied.has('highlight')
        ? 'highlight'
        : undefined;
    if (!annotationType) continue;
    occupied.add(annotationType);
    occupiedAnnotationTypes.set(cfiRange, occupied);
    renderedLearningNoteMarks.push({ mark, annotationType });
  }
  const lanes = assignEpubExplanationLanes([
    ...explanations.map((explanation) => ({
      id: `explanation:${explanation.id}`,
      cfiRange: explanation.target.targetPayload.cfiRange,
    })),
    ...readingNotes.map((note) => ({
      id: `note:${note.id}`,
      cfiRange: note.target.targetPayload.cfiRange,
    })),
    ...renderedLearningNoteMarks.map(({ mark }) => ({
      id: `learning-note:${mark.id}`,
      cfiRange: mark.target.targetPayload.cfiRange,
    })),
  ]);

  for (const explanation of explanations) {
    annotations.underline(
      explanation.target.targetPayload.cfiRange,
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
      note.target.targetPayload.cfiRange,
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

  for (const { mark, annotationType } of renderedLearningNoteMarks) {
    annotations[annotationType](
      mark.target.targetPayload.cfiRange,
      { learningNoteReferenceId: mark.id },
      () => undefined,
      'epub-project-learning-note-reference',
      {
        ...epubAnnotationWaveStyles(
          lanes[`learning-note:${mark.id}`] ?? 0,
          'red',
          'rect',
        ),
        ...(annotationType === 'highlight'
          ? { fill: 'none', 'fill-opacity': '0' }
          : {}),
      },
    );
  }

  return () => {
    for (const explanation of explanations) {
      annotations.remove(
        explanation.target.targetPayload.cfiRange,
        'underline',
      );
    }
    for (const note of readingNotes) {
      annotations.remove(
        note.target.targetPayload.cfiRange,
        'highlight',
      );
    }
    for (const { mark, annotationType } of renderedLearningNoteMarks) {
      annotations.remove(
        mark.target.targetPayload.cfiRange,
        annotationType,
      );
    }
  };
}
