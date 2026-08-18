import type { EpubExplanationView } from './shared';

export interface EpubExplanationLocationDisplay {
  display(target: string): Promise<void>;
}

export function displayEpubExplanationLocation(
  rendition: EpubExplanationLocationDisplay,
  explanation: EpubExplanationView,
): Promise<void> {
  return rendition.display(explanation.target.anchorPayload.cfiRange);
}
