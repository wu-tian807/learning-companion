export type SettingsTarget =
  | { readonly section: 'general' }
  | {
      readonly section: 'external-libraries';
      readonly libraryId?: string;
    };
