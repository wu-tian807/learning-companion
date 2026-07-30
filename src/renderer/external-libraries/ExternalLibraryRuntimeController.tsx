import { useEffect } from 'react';

import {
  notificationStore,
} from '../notifications/notification-store';
import type { SettingsTarget } from '../settings/settings-target';
import {
  externalLibraryStore,
} from './external-library-store';
import { handleExternalLibraryNotification } from './external-library-notification-adapter';

interface ExternalLibraryRuntimeControllerProps {
  readonly onOpenSettings: (target: SettingsTarget) => void;
}

export function ExternalLibraryRuntimeController({
  onOpenSettings,
}: ExternalLibraryRuntimeControllerProps) {
  useEffect(
    () =>
      externalLibraryStore.getState().connect((transition) => {
        handleExternalLibraryNotification(transition, {
          notifications: notificationStore,
          openSettings: onOpenSettings,
        });
      }),
    [onOpenSettings],
  );

  return null;
}
