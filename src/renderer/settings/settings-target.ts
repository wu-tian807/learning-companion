export type SettingsTarget =
  | { readonly section: 'general' }
  | { readonly section: 'agent-providers' }
  | {
      readonly section: 'external-libraries';
      readonly libraryId?: string;
    };
