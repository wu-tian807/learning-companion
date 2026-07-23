import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const outputDirectory = path.resolve('out');
const expectedSuffix = path.join(
  'app.asar.unpacked',
  'node_modules',
  'better-sqlite3',
  'prebuilds',
  `${process.platform}-${process.arch}.node`,
);

function findExpectedBinary(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      const nestedResult = findExpectedBinary(entryPath);

      if (nestedResult) {
        return nestedResult;
      }
    } else if (entryPath.endsWith(expectedSuffix)) {
      return entryPath;
    }
  }

  return undefined;
}

function findAppAsar(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      const nestedResult = findAppAsar(entryPath);

      if (nestedResult) {
        return nestedResult;
      }
    } else if (entry.name === 'app.asar') {
      return entryPath;
    }
  }

  return undefined;
}

assert.ok(fs.existsSync(outputDirectory), '尚未生成 out 打包目录');
assert.ok(process.versions.electron, '打包验证必须运行在 Electron 中');

const nativeBinary = findExpectedBinary(outputDirectory);
const appAsar = findAppAsar(outputDirectory);

assert.ok(
  nativeBinary,
  `打包产物中缺少解包后的原生模块：${expectedSuffix}`,
);
assert.ok(appAsar, '打包产物中缺少 app.asar');

const packagedRequire = createRequire(import.meta.url);
const PackagedDatabase = packagedRequire(
  path.join(appAsar, 'node_modules/better-sqlite3'),
);
const database = new PackagedDatabase(':memory:');

try {
  database.exec('CREATE VIRTUAL TABLE package_smoke USING fts5(content)');
  database
    .prepare('INSERT INTO package_smoke (content) VALUES (?)')
    .run('packaged native module');

  const result = database
    .prepare(
      "SELECT content FROM package_smoke WHERE package_smoke MATCH 'native'",
    )
    .get();

  assert.deepEqual(result, { content: 'packaged native module' });
  console.log(`packaged native module verified: ${nativeBinary}`);
} finally {
  database.close();
}

process.exit();
