import { describe, expect, it } from 'vitest';

import type { FileSystemPathRules } from '../../filesystem/file-system-path-rules';
import { createAgentCapabilityPaths } from './agent-capability-paths';

const windowsPathRules: FileSystemPathRules = {
  isAbsolute: (path) => /^[A-Za-z]:\\/u.test(path),
  join: (...paths) => paths.join('\\'),
  normalize: (path) => path.replaceAll('/', '\\'),
  parse: (path) => ({ root: path.slice(0, 3) }),
  relative: () => '',
  resolve: (...paths) => paths.join('\\'),
  sep: '\\',
};

describe('createAgentCapabilityPaths', () => {
  it('places application capabilities under the Documents application root', () => {
    expect(
      createAgentCapabilityPaths(
        'C:\\Users\\student\\Documents',
        windowsPathRules,
      ),
    ).toEqual({
      rootPath:
        'C:\\Users\\student\\Documents\\Learning Companion\\agent-capabilities',
      skillsPath:
        'C:\\Users\\student\\Documents\\Learning Companion\\agent-capabilities\\skills',
      mcpPath:
        'C:\\Users\\student\\Documents\\Learning Companion\\agent-capabilities\\mcp',
    });
  });

  it('rejects a relative Documents path', () => {
    expect(() =>
      createAgentCapabilityPaths('Documents', windowsPathRules),
    ).toThrow('DATA_INTEGRITY_ERROR');
  });
});
