const LANGUAGE_NAMES = Object.freeze({
  en: 'English',
  zh: 'Simplified Chinese',
});

export function createHyMt2CuePrompt(cues, cueIndex, from, to) {
  const sourceLanguage = LANGUAGE_NAMES[from];
  const targetLanguage = LANGUAGE_NAMES[to];
  if (!sourceLanguage || !targetLanguage || from === to) {
    throw new Error(`Unsupported Hy-MT2 language pair: ${from}-${to}`);
  }
  const previous = cues[cueIndex - 1]?.text ?? '(none)';
  const current = cues[cueIndex]?.text;
  const next = cues[cueIndex + 1]?.text ?? '(none)';
  if (typeof current !== 'string') throw new Error(`Unknown Hy-MT2 cue index: ${cueIndex}`);
  return [
    '[Background Information]',
    `Previous subtitle: ${previous}`,
    `Next subtitle: ${next}`,
    '',
    '[Translation Task]',
    `Translate the [Source Text] from ${sourceLanguage} into ${targetLanguage}, taking the background information into consideration.`,
    'Translate [Source Text] only. Output only its natural spoken subtitle translation without labels or explanations.',
    '',
    '[Source Text]',
    current,
  ].join('\n');
}

export function parseHyMt2CueResponse(responseText) {
  const translatedText = responseText
    .replace(/^```(?:text)?\s*/iu, '')
    .replace(/\s*```$/u, '')
    .replace(/^\s*(?:translation|译文)\s*[:：]\s*/iu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!translatedText) throw new Error('Hy-MT2 returned an empty cue translation.');
  return translatedText;
}
