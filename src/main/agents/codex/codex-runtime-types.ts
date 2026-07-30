export type CodexJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly CodexJsonValue[]
  | CodexJsonObject;

export interface CodexJsonObject {
  readonly [key: string]: CodexJsonValue | undefined;
}

export type CodexRpcId = number | string;

export type CodexRuntimePhase =
  | 'stopped'
  | 'starting'
  | 'ready'
  | 'stopping'
  | 'failed';

export interface CodexRuntimeSnapshot {
  readonly phase: CodexRuntimePhase;
  readonly failure?: {
    readonly message: string;
  };
}

export interface CodexAccount {
  readonly type: string;
  readonly email?: string | null;
  readonly planType?: string | null;
  readonly credentialSource?: string;
  readonly usesCodexManagedCredentials?: boolean;
}

export interface CodexAccountState {
  readonly account: CodexAccount | null;
  readonly requiresOpenaiAuth: boolean;
}

export type CodexLoginChallenge =
  | {
      readonly type: 'chatgpt';
      readonly loginId: string;
      readonly authUrl: string;
    }
  | {
      readonly type: 'chatgptDeviceCode';
      readonly loginId: string;
      readonly verificationUrl: string;
      readonly userCode: string;
    };

export interface CodexThread {
  readonly id: string;
  readonly sessionId?: string;
  readonly preview?: string;
  readonly name?: string | null;
  readonly cwd?: string;
  readonly createdAt?: number;
  readonly updatedAt?: number;
  readonly status?: unknown;
  readonly turns?: readonly CodexTurn[];
  readonly [key: string]: unknown;
}

export interface CodexTurn {
  readonly id: string;
  readonly status: string;
  readonly items?: readonly CodexThreadItem[];
  readonly error?: CodexTurnError | null;
  readonly [key: string]: unknown;
}

export interface CodexTurnError {
  readonly message: string;
  readonly codexErrorInfo?: unknown;
  readonly additionalDetails?: string | null;
}

export interface CodexThreadItem {
  readonly id: string;
  readonly type: string;
  readonly [key: string]: unknown;
}

export interface CodexThreadSelection {
  readonly thread: CodexThread;
  readonly model?: string;
  readonly modelProvider?: string;
  readonly cwd?: string;
  readonly instructionSources?: readonly string[];
  readonly [key: string]: unknown;
}

export interface CodexThreadPage {
  readonly data: readonly CodexThread[];
  readonly nextCursor: string | null;
  readonly backwardsCursor?: string | null;
}

export type CodexApprovalPolicy =
  | 'untrusted'
  | 'on-request'
  | 'never'
  | {
      readonly granular: {
        readonly sandbox_approval: boolean;
        readonly rules: boolean;
        readonly skill_approval: boolean;
        readonly request_permissions: boolean;
        readonly mcp_elicitations: boolean;
      };
    };

export type CodexThreadSandbox =
  | 'read-only'
  | 'workspace-write'
  | 'danger-full-access';

export type CodexTurnSandboxPolicy =
  | {
      readonly type: 'dangerFullAccess';
    }
  | {
      readonly type: 'readOnly';
      readonly networkAccess: boolean;
    }
  | {
      readonly type: 'workspaceWrite';
      readonly writableRoots: readonly string[];
      readonly networkAccess: boolean;
      readonly excludeTmpdirEnvVar: boolean;
      readonly excludeSlashTmp: boolean;
    }
  | {
      readonly type: 'externalSandbox';
      readonly networkAccess: 'restricted' | 'enabled';
    };

export type CodexPersonality = 'none' | 'friendly' | 'pragmatic';

export interface CodexDynamicFunctionTool {
  readonly type: 'function';
  readonly name: string;
  readonly description: string;
  readonly inputSchema: CodexJsonValue;
  readonly deferLoading?: boolean;
}

export interface CodexDynamicToolNamespace {
  readonly type: 'namespace';
  readonly name: string;
  readonly description: string;
  readonly tools: readonly CodexDynamicFunctionTool[];
}

export type CodexDynamicTool =
  | CodexDynamicFunctionTool
  | CodexDynamicToolNamespace;

export interface CodexThreadConfiguration {
  readonly model?: string;
  readonly modelProvider?: string;
  readonly serviceTier?: string;
  readonly cwd?: string;
  readonly runtimeWorkspaceRoots?: readonly string[];
  readonly approvalPolicy?: CodexApprovalPolicy;
  readonly sandbox?: CodexThreadSandbox;
  readonly permissions?: string;
  readonly configOverrides?: CodexJsonObject;
  readonly baseInstructions?: string;
  readonly developerInstructions?: string;
  readonly personality?: CodexPersonality;
}

export type CreateCodexThreadInput = CodexThreadConfiguration & {
  readonly ephemeral?: boolean;
  readonly serviceName?: string;
  readonly dynamicTools?: readonly CodexDynamicTool[];
};

export type SelectCodexThreadInput = CodexThreadConfiguration & {
  readonly threadId: string;
  readonly excludeTurns?: boolean;
};

export interface ListCodexThreadsInput {
  readonly cursor?: string;
  readonly limit?: number;
  readonly archived?: boolean;
  readonly cwd?: string | readonly string[];
  readonly searchTerm?: string;
  readonly useStateDbOnly?: boolean;
}

export type CodexTurnUserInput =
  | {
      readonly type: 'text';
      readonly text: string;
    }
  | {
      readonly type: 'image';
      readonly url: string;
      readonly detail?: 'auto' | 'low' | 'high' | 'original';
    }
  | {
      readonly type: 'localImage';
      readonly path: string;
      readonly detail?: 'auto' | 'low' | 'high' | 'original';
    }
  | {
      readonly type: 'audio';
      readonly url: string;
    }
  | {
      readonly type: 'localAudio';
      readonly path: string;
    }
  | {
      readonly type: 'skill';
      readonly name: string;
      readonly path: string;
    }
  | {
      readonly type: 'mention';
      readonly name: string;
      readonly path: string;
    };

export interface StartCodexTurnInput {
  readonly threadId: string;
  readonly clientUserMessageId?: string;
  readonly input: readonly CodexTurnUserInput[];
  readonly responsesApiClientMetadata?: Readonly<Record<string, string>>;
  readonly additionalContext?: Readonly<
    Record<
      string,
      {
        readonly value: string;
        readonly kind: 'untrusted' | 'application';
      }
    >
  >;
  readonly cwd?: string;
  readonly runtimeWorkspaceRoots?: readonly string[];
  readonly approvalPolicy?: CodexApprovalPolicy;
  readonly sandboxPolicy?: CodexTurnSandboxPolicy;
  readonly permissions?: string;
  readonly model?: string;
  readonly serviceTier?: string;
  readonly effort?: string;
  readonly summary?: 'auto' | 'concise' | 'detailed' | 'none';
  readonly personality?: CodexPersonality;
  readonly outputSchema?: CodexJsonValue;
}

export interface CodexServerRequest {
  readonly requestId: CodexRpcId;
  readonly method: string;
  readonly params: unknown;
}

export type CodexTurnEvent =
  | {
      readonly type: 'turn-started';
      readonly threadId: string;
      readonly turn: CodexTurn;
    }
  | {
      readonly type: 'assistant-message-delta';
      readonly threadId: string;
      readonly turnId: string;
      readonly itemId: string;
      readonly delta: string;
    }
  | {
      readonly type: 'item-started' | 'item-completed';
      readonly threadId: string;
      readonly turnId: string;
      readonly item: CodexThreadItem;
    }
  | {
      readonly type: 'server-request';
      readonly threadId: string;
      readonly turnId?: string;
      readonly request: CodexServerRequest;
    }
  | {
      readonly type:
        | 'plan-updated'
        | 'diff-updated'
        | 'token-usage-updated'
        | 'warning'
        | 'notification';
      readonly threadId: string;
      readonly turnId?: string;
      readonly method: string;
      readonly params: unknown;
    }
  | {
      readonly type: 'error';
      readonly threadId: string;
      readonly turnId: string;
      readonly error: CodexTurnError;
      readonly willRetry: boolean;
    }
  | {
      readonly type: 'turn-completed';
      readonly threadId: string;
      readonly turn: CodexTurn;
    };

export interface CodexTurnResult {
  readonly threadId: string;
  readonly turn: CodexTurn;
}

export interface InterruptCodexTurnInput {
  readonly threadId: string;
  readonly turnId: string;
}

export interface CodexRuntimeNotification {
  readonly method: string;
  readonly params: unknown;
}

export type CodexRuntimeEvent =
  | {
      readonly type: 'state-changed';
      readonly snapshot: CodexRuntimeSnapshot;
    }
  | {
      readonly type: 'notification';
      readonly notification: CodexRuntimeNotification;
    }
  | {
      readonly type: 'unmatched-server-request';
      readonly request: CodexServerRequest;
    };

export interface CodexModel {
  readonly id: string;
  readonly model: string;
  readonly displayName: string;
  readonly description: string;
  readonly hidden: boolean;
  readonly isDefault: boolean;
  readonly inputModalities: readonly string[];
  readonly supportedReasoningEfforts: readonly unknown[];
  readonly defaultReasoningEffort: string;
  readonly supportsPersonality: boolean;
  readonly [key: string]: unknown;
}

export interface CodexModelPage {
  readonly data: readonly CodexModel[];
  readonly nextCursor: string | null;
}

export interface CodexSkill {
  readonly name: string;
  readonly description: string;
  readonly path: string;
  readonly enabled: boolean;
  readonly scope?: string;
  readonly [key: string]: unknown;
}

export interface CodexSkillsByDirectory {
  readonly cwd: string;
  readonly skills: readonly CodexSkill[];
  readonly errors?: readonly unknown[];
}

export interface CodexMcpServer {
  readonly name: string;
  readonly authStatus: unknown;
  readonly tools: Readonly<Record<string, unknown>>;
  readonly [key: string]: unknown;
}

export interface CodexMcpServerPage {
  readonly data: readonly CodexMcpServer[];
  readonly nextCursor: string | null;
}
