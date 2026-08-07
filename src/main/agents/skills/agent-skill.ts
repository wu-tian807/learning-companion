export interface AgentSkillDefinition {
  readonly id: string;
  readonly version: number;
  readonly description: string;
  readonly directoryPath: string;
  readonly skillFilePath: string;
}

export interface InstallAgentSkillInput {
  readonly id: string;
  readonly version: number;
  readonly sourceDirectory: string;
}

export interface AgentSkillFrontmatter {
  readonly name: string;
  readonly description: string;
}

function parseYamlScalar(value: string): string {
  const normalized = value.trim();

  if (
    normalized.length >= 2 &&
    normalized.startsWith('"') &&
    normalized.endsWith('"')
  ) {
    try {
      const parsed: unknown = JSON.parse(normalized);
      return typeof parsed === 'string' ? parsed.trim() : '';
    } catch {
      return '';
    }
  }

  if (
    normalized.length >= 2 &&
    normalized.startsWith("'") &&
    normalized.endsWith("'")
  ) {
    return normalized.slice(1, -1).replaceAll("''", "'").trim();
  }

  return normalized;
}

function frontmatterValue(
  frontmatter: string,
  key: string,
): string | undefined {
  const lines = frontmatter.split(/\r?\n/u);
  const prefix = `${key}:`;
  const index = lines.findIndex((line) => line.startsWith(prefix));

  if (index < 0) {
    return undefined;
  }

  const inline = lines[index].slice(prefix.length).trim();

  if (!['|', '|-', '>', '>-'].includes(inline)) {
    return parseYamlScalar(inline) || undefined;
  }

  const continuation: string[] = [];

  for (const line of lines.slice(index + 1)) {
    if (line.length > 0 && !/^\s/u.test(line)) {
      break;
    }

    const text = line.trim();

    if (text) {
      continuation.push(text);
    }
  }

  return continuation.join(inline.startsWith('|') ? '\n' : ' ') || undefined;
}

export function parseAgentSkillFrontmatter(
  content: string,
): AgentSkillFrontmatter {
  const normalized = content.replace(/^\uFEFF/u, '');
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(normalized);

  if (!match) {
    throw new AppError('INVALID_EXTENSION_DEFINITION');
  }

  const name = frontmatterValue(match[1], 'name');
  const description = frontmatterValue(match[1], 'description');

  if (!name || !description) {
    throw new AppError('INVALID_EXTENSION_DEFINITION');
  }

  return Object.freeze({ name, description });
}

export function requireAgentSkillVersion(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new AppError('INVALID_EXTENSION_DEFINITION');
  }

  return value;
}
import { AppError } from '../../errors/app-error';
