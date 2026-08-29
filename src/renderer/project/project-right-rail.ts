export interface ProjectRightRail {
  readonly kind: 'conversation' | 'generation';
  readonly className: string;
}

export function resolveProjectRightRail({
  conversationOpen,
  generationOpen,
  generationInline,
}: {
  readonly conversationOpen: boolean;
  readonly generationOpen: boolean;
  readonly generationInline: boolean;
}): ProjectRightRail | undefined {
  if (conversationOpen) {
    return {
      kind: 'conversation',
      className: 'h-full w-[clamp(318px,20vw,390px)] shrink-0',
    };
  }
  if (!generationOpen) return undefined;
  return {
    kind: 'generation',
    className: generationInline
      ? 'h-full w-[clamp(318px,20vw,390px)] shrink-0'
      : 'absolute inset-y-0 right-0 z-30 h-full w-[min(390px,calc(100%-20px))] shadow-2xl',
  };
}
