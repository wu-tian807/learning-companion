import { open } from 'node:fs/promises';

export type TextEncoding = 'utf-8' | 'gbk';

export const TEXT_CONTENT_SAMPLE_SIZE = 64 * 1024;

export interface TextEncodingDetector {
  readonly encoding: TextEncoding;
  canDecode(content: Uint8Array): boolean;
}

const permittedControlCodePoints = new Set([0x09, 0x0a, 0x0c, 0x0d]);

function hasAcceptableTextCharacters(value: string): boolean {
  let controlCharacters = 0;
  let characterCount = 0;

  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    characterCount += 1;

    if (
      (codePoint < 0x20 && !permittedControlCodePoints.has(codePoint)) ||
      (codePoint >= 0x7f && codePoint <= 0x9f)
    ) {
      controlCharacters += 1;
    }
  }

  return (
    characterCount === 0 || controlCharacters / characterCount <= 0.01
  );
}

export function createTextEncodingDetector(
  encoding: TextEncoding,
): TextEncodingDetector {
  return {
    encoding,
    canDecode(content) {
      try {
        const decoded = new TextDecoder(encoding, { fatal: true }).decode(
          content,
        );
        return hasAcceptableTextCharacters(decoded);
      } catch {
        return false;
      }
    },
  };
}

export const defaultTextEncodingDetectors: readonly TextEncodingDetector[] = [
  createTextEncodingDetector('utf-8'),
  createTextEncodingDetector('gbk'),
];

export function detectTextEncoding(
  content: Uint8Array,
  detectors: readonly TextEncodingDetector[] = defaultTextEncodingDetectors,
): TextEncoding | undefined {
  if (content.includes(0)) {
    return undefined;
  }

  return detectors.find((detector) => detector.canDecode(content))?.encoding;
}

export async function detectFileTextEncoding(
  path: string,
): Promise<TextEncoding | undefined> {
  const file = await open(path, 'r');

  try {
    const sample = Buffer.alloc(TEXT_CONTENT_SAMPLE_SIZE);
    const { bytesRead } = await file.read(
      sample,
      0,
      TEXT_CONTENT_SAMPLE_SIZE,
      0,
    );

    return detectTextEncoding(sample.subarray(0, bytesRead));
  } finally {
    await file.close();
  }
}
