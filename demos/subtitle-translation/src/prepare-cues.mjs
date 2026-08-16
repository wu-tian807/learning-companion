const SENTENCE_END = /[.!?。！？][\]})"'”’]*$/u;

function joinText(cues) {
  return cues
    .map((cue) => cue.text.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function prepareCuesForTranslation(
  cues,
  language,
  { maxDurationMs = 8_000, maxGapMs = 700, maxCharacters } = {},
) {
  const characterLimit = maxCharacters ?? (language.toLowerCase().startsWith('zh') ? 64 : 180);
  const prepared = [];
  let group = [];

  const flush = () => {
    if (group.length === 0) return;
    prepared.push({
      id: `cue-${String(prepared.length + 1).padStart(6, '0')}`,
      startMs: group[0].startMs,
      endMs: group.at(-1).endMs,
      text: joinText(group),
      sourceCueIds: group.map((cue) => cue.id),
    });
    group = [];
  };

  for (const cue of cues) {
    if (group.length > 0) {
      const previous = group.at(-1);
      const combinedText = joinText([...group, cue]);
      const exceedsBoundary =
        cue.startMs - previous.endMs > maxGapMs ||
        cue.endMs - group[0].startMs > maxDurationMs ||
        combinedText.length > characterLimit;
      if (exceedsBoundary) flush();
    }
    group.push(cue);
    if (SENTENCE_END.test(cue.text.trim())) flush();
  }
  flush();
  return prepared;
}
