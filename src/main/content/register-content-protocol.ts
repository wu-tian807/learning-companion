import { protocol, type Protocol } from 'electron';

import {
  CONTENT_RESOURCE_SCHEME,
  type ContentResourceServiceApi,
} from './content-resource-service';

export function registerContentSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: CONTENT_RESOURCE_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
}

export function registerContentProtocol(
  resourceService: ContentResourceServiceApi,
  targetProtocol: Protocol = protocol,
): void {
  targetProtocol.handle(CONTENT_RESOURCE_SCHEME, (request) =>
    resourceService.handle(request),
  );
}

export function removeContentProtocol(
  targetProtocol: Protocol = protocol,
): void {
  if (targetProtocol.isProtocolHandled(CONTENT_RESOURCE_SCHEME)) {
    targetProtocol.unhandle(CONTENT_RESOURCE_SCHEME);
  }
}
