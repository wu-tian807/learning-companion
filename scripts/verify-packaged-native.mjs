import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const outputDirectory = path.resolve('out');
const betterSqlite3ExpectedSuffix = path.join(
  'app.asar.unpacked',
  'node_modules',
  'better-sqlite3',
  'prebuilds',
  `${process.platform}-${process.arch}.node`,
);

function findExpectedBinary(directory, expectedSuffix) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      const nestedResult = findExpectedBinary(entryPath, expectedSuffix);

      if (nestedResult) {
        return nestedResult;
      }
    } else if (entryPath.endsWith(expectedSuffix)) {
      return entryPath;
    }
  }

  return undefined;
}

function findPackagedCanvasBinary(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      const nestedResult = findPackagedCanvasBinary(entryPath);

      if (nestedResult) {
        return nestedResult;
      }
      continue;
    }

    const normalizedPath = entryPath.split(path.sep).join('/');
    if (
      entry.name.endsWith('.node') &&
      normalizedPath.includes(
        '/app.asar.unpacked/node_modules/@napi-rs/canvas-',
      )
    ) {
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

const betterSqlite3Binary = findExpectedBinary(
  outputDirectory,
  betterSqlite3ExpectedSuffix,
);
const canvasBinary = findPackagedCanvasBinary(outputDirectory);
const appAsar = findAppAsar(outputDirectory);

assert.ok(
  betterSqlite3Binary,
  `打包产物中缺少解包后的原生模块：${betterSqlite3ExpectedSuffix}`,
);
assert.ok(
  canvasBinary,
  '打包产物中缺少 @napi-rs/canvas 的解包原生模块',
);
assert.ok(appAsar, '打包产物中缺少 app.asar');

const packagedRequire = createRequire(import.meta.url);
const packagedJsdomPath = path.join(appAsar, 'node_modules', 'jsdom');
const packagedPdfJsPath = path.join(
  appAsar,
  'node_modules',
  'pdfjs-dist',
  'legacy',
  'build',
  'pdf.mjs',
);
assert.ok(
  fs.existsSync(packagedPdfJsPath),
  `打包产物中缺少 PDF.js：${packagedPdfJsPath}`,
);
assert.ok(
  fs.existsSync(path.join(packagedJsdomPath, 'package.json')),
  `打包产物中缺少 jsdom：${packagedJsdomPath}`,
);
const PackagedDatabase = packagedRequire(
  path.join(appAsar, 'node_modules/better-sqlite3'),
);
const { createCanvas } = packagedRequire(
  path.join(appAsar, 'node_modules/@napi-rs/canvas'),
);
const { JSDOM } = packagedRequire(packagedJsdomPath);
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
  const canvas = createCanvas(2, 2);
  assert.equal(canvas.width, 2);
  assert.equal(canvas.height, 2);
  assert.ok(canvas.encodeSync('png').byteLength > 0);
  const pdfjs = await import(pathToFileURL(packagedPdfJsPath).href);
  assert.equal(typeof pdfjs.getDocument, 'function');
  const dom = new JSDOM('<!doctype html><p id="packaged">ready</p>', {
    includeNodeLocations: true,
  });
  try {
    assert.equal(
      dom.window.document.querySelector('#packaged')?.textContent,
      'ready',
    );
  } finally {
    dom.window.close();
  }

  console.log(
    `packaged runtime dependencies verified: ${betterSqlite3Binary}, ${canvasBinary}, ${packagedPdfJsPath}, ${packagedJsdomPath}`,
  );
} finally {
  database.close();
}

process.exit();
