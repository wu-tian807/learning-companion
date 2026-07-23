import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

let database;

try {
  assert.ok(process.versions.electron, '烟雾测试必须运行在 Electron 中');

  database = new Database(':memory:');
  database.exec(`
    CREATE TABLE smoke_items (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE smoke_items_fts USING fts5(title);
  `);

  database
    .prepare('INSERT INTO smoke_items (title) VALUES (?)')
    .run('Learning Companion');
  database
    .prepare('INSERT INTO smoke_items_fts (title) VALUES (?)')
    .run('边看边问 AI');

  const item = database
    .prepare('SELECT title FROM smoke_items WHERE id = 1')
    .get();
  const searchResult = database
    .prepare(
      "SELECT title FROM smoke_items_fts WHERE smoke_items_fts MATCH 'AI'",
    )
    .get();
  const sqlite = database
    .prepare('SELECT sqlite_version() AS version')
    .get();

  assert.deepEqual(item, { title: 'Learning Companion' });
  assert.deepEqual(searchResult, { title: '边看边问 AI' });

  console.log(
    `better-sqlite3 smoke passed: Electron ${process.versions.electron}, SQLite ${sqlite.version}, ${process.platform}/${process.arch}`,
  );
} catch (error) {
  console.error('better-sqlite3 smoke failed:', error);
  process.exitCode = 1;
} finally {
  database?.close();
}

process.exit();
