import type {
  AgentMcpServerRequirement,
  AgentSkillRequirement,
} from '../../generation/contracts/task-definition';
import { AppError } from '../../errors/app-error';
import type { CodexJsonObject } from '../codex/codex-runtime-types';
import type { AgentMcpServerDefinition } from '../mcp/agent-mcp-server';
import type { AgentMcpServerLookup } from '../mcp/agent-mcp-service';
import type { AgentSkillDefinition } from '../skills/agent-skill';
import type { AgentSkillLookup } from '../skills/agent-skill-service';

const codexMcpServerPrefix = 'learning_companion_';

export interface ResolvedCodexSkill {
  readonly id: string;
  readonly version: number;
  readonly description: string;
  readonly directoryPath: string;
  readonly path: string;
}

export interface ResolvedCodexMcpServer {
  readonly id: string;
  readonly availability: 'required' | 'optional';
  readonly wireName: string;
  readonly definition: AgentMcpServerDefinition;
  readonly config: CodexJsonObject;
}

export interface CodexGenerationCapabilitySelection {
  readonly skills: readonly ResolvedCodexSkill[];
  readonly mcpServers: readonly ResolvedCodexMcpServer[];
  readonly mcpServerIdsByWireName: ReadonlyMap<string, string>;
}

export interface CodexGenerationCapabilityDependencies {
  readonly skills: AgentSkillLookup;
  readonly mcpServers: AgentMcpServerLookup;
}

function toCodexMcpServerConfig(
  definition: AgentMcpServerDefinition,
  availability: 'required' | 'optional',
): CodexJsonObject {
  const common: CodexJsonObject = {
    enabled: true,
    required: availability === 'required',
    default_tools_approval_mode: 'approve',
    ...(definition.startupTimeoutMs
      ? { startup_timeout_ms: definition.startupTimeoutMs }
      : {}),
    ...(definition.toolTimeoutMs
      ? { tool_timeout_sec: definition.toolTimeoutMs / 1_000 }
      : {}),
    ...(definition.enabledTools
      ? { enabled_tools: definition.enabledTools }
      : {}),
    ...(definition.disabledTools
      ? { disabled_tools: definition.disabledTools }
      : {}),
  };

  if (definition.transport.type === 'stdio') {
    return Object.freeze({
      ...common,
      command: definition.transport.command,
      ...(definition.transport.args
        ? { args: definition.transport.args }
        : {}),
      ...(definition.transport.workingDirectory
        ? { cwd: definition.transport.workingDirectory }
        : {}),
      ...(definition.transport.environment
        ? { env: definition.transport.environment }
        : {}),
      ...(definition.transport.environmentVariables
        ? { env_vars: definition.transport.environmentVariables }
        : {}),
    });
  }

  return Object.freeze({
    ...common,
    url: definition.transport.url,
    ...(definition.transport.bearerTokenEnvironmentVariable
      ? {
          bearer_token_env_var:
            definition.transport.bearerTokenEnvironmentVariable,
        }
      : {}),
    ...(definition.transport.headers
      ? { http_headers: definition.transport.headers }
      : {}),
    ...(definition.transport.environmentHeaders
      ? { env_http_headers: definition.transport.environmentHeaders }
      : {}),
  });
}

async function resolveSkills(
  requirements: readonly AgentSkillRequirement[],
  lookup: AgentSkillLookup,
): Promise<readonly ResolvedCodexSkill[]> {
  const resolved: ResolvedCodexSkill[] = [];

  for (const requirement of requirements) {
    const skill: AgentSkillDefinition | undefined = await lookup.get(
      requirement.id,
    );

    if (!skill) {
      if (requirement.availability === 'required') {
        throw new AppError('FEATURE_NOT_SUPPORTED');
      }
      continue;
    }

    resolved.push(
      Object.freeze({
        id: skill.id,
        version: skill.version,
        description: skill.description,
        directoryPath: skill.directoryPath,
        path: skill.skillFilePath,
      }),
    );
  }

  return Object.freeze(resolved);
}

async function resolveMcpServers(
  requirements: readonly AgentMcpServerRequirement[],
  lookup: AgentMcpServerLookup,
): Promise<readonly ResolvedCodexMcpServer[]> {
  const resolved: ResolvedCodexMcpServer[] = [];

  for (const requirement of requirements) {
    const definition = await lookup.get(requirement.id);

    if (!definition) {
      if (requirement.availability === 'required') {
        throw new AppError('FEATURE_NOT_SUPPORTED');
      }
      continue;
    }

    resolved.push(
      Object.freeze({
        id: definition.id,
        availability: requirement.availability,
        wireName: `${codexMcpServerPrefix}${definition.id}`,
        definition,
        config: toCodexMcpServerConfig(
          definition,
          requirement.availability,
        ),
      }),
    );
  }

  return Object.freeze(resolved);
}

export async function resolveCodexGenerationCapabilities(
  skillRequirements: readonly AgentSkillRequirement[],
  mcpRequirements: readonly AgentMcpServerRequirement[],
  dependencies: CodexGenerationCapabilityDependencies,
): Promise<CodexGenerationCapabilitySelection> {
  const [skills, mcpServers] = await Promise.all([
    resolveSkills(skillRequirements, dependencies.skills),
    resolveMcpServers(mcpRequirements, dependencies.mcpServers),
  ]);

  return Object.freeze({
    skills,
    mcpServers,
    mcpServerIdsByWireName: new Map(
      mcpServers.map(({ wireName, id }) => [wireName, id]),
    ),
  });
}
