export function documentContentLayoutClassName(sidebarOpen: boolean): string {
  return sidebarOpen
    ? 'mr-[332px] h-full min-h-0 min-w-0 flex-1 overflow-hidden'
    : 'h-full min-h-0 min-w-0 flex-1 overflow-hidden';
}
