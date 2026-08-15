/**
 * Narrow capability for executing a trusted Workbench-owned script inside
 * a document owned by an active sandbox-frame transport session.
 *
 * Renderer input never supplies script source. A Main Workbench Provider owns
 * the media-specific command and constructs the trusted script; the transport
 * bridge owns frame discovery and lifecycle validation.
 */
export interface SandboxFrameScriptExecutor {
  executeJavaScript(
    sessionId: string,
    script: string,
    target?: { readonly frameUrl: string },
  ): Promise<unknown>;
}
