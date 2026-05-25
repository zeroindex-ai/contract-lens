import { describe, expect, it } from 'vitest';
import { inMemoryClient } from './client';
import { splitSqlStatements } from './schema';

describe('splitSqlStatements', () => {
  it('splits plain statements on top-level semicolons', () => {
    const sql = `CREATE TABLE a (id TEXT);
CREATE TABLE b (id TEXT);`;
    expect(splitSqlStatements(sql)).toEqual(['CREATE TABLE a (id TEXT)', 'CREATE TABLE b (id TEXT)']);
  });

  it('does NOT split on a semicolon inside a single-quoted string literal', () => {
    const sql = `INSERT INTO t (msg) VALUES ('hello; world');
INSERT INTO t (msg) VALUES ('next');`;
    const out = splitSqlStatements(sql);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe("INSERT INTO t (msg) VALUES ('hello; world')");
    expect(out[1]).toBe("INSERT INTO t (msg) VALUES ('next')");
  });

  it('handles doubled-quote escaping inside a string literal', () => {
    const sql = `INSERT INTO t (msg) VALUES ('it''s a; test');`;
    expect(splitSqlStatements(sql)).toEqual(["INSERT INTO t (msg) VALUES ('it''s a; test')"]);
  });

  it('does NOT split on semicolons inside a BEGIN...END trigger body', () => {
    const sql = `CREATE TABLE log (id INTEGER PRIMARY KEY, note TEXT);
CREATE TRIGGER trg AFTER INSERT ON log
BEGIN
  UPDATE log SET note = 'a; b' WHERE id = NEW.id;
  INSERT INTO log (note) VALUES ('done;');
END;
CREATE INDEX idx_log ON log(id);`;
    const out = splitSqlStatements(sql);
    expect(out).toHaveLength(3);
    expect(out[0]).toBe('CREATE TABLE log (id INTEGER PRIMARY KEY, note TEXT)');
    expect(out[1]).toContain('CREATE TRIGGER trg');
    expect(out[1]).toContain("UPDATE log SET note = 'a; b' WHERE id = NEW.id;");
    expect(out[1]).toContain("INSERT INTO log (note) VALUES ('done;');");
    expect(out[1]?.trimEnd().endsWith('END')).toBe(true);
    expect(out[2]).toBe('CREATE INDEX idx_log ON log(id)');
  });

  it('strips line and block comments and ignores their semicolons', () => {
    const sql = `-- a; comment with a semicolon
CREATE TABLE a (id TEXT); /* block; comment */
CREATE TABLE b (id TEXT);`;
    const out = splitSqlStatements(sql);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe('CREATE TABLE a (id TEXT)');
    expect(out[1]).toBe('CREATE TABLE b (id TEXT)');
  });

  it('keeps a BEGIN that appears inside a word boundary only when standalone', () => {
    // "BEGINNING" must not be treated as the BEGIN keyword.
    const sql = `INSERT INTO t (msg) VALUES ('BEGINNING; END');
CREATE TABLE a (id TEXT);`;
    const out = splitSqlStatements(sql);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe("INSERT INTO t (msg) VALUES ('BEGINNING; END')");
  });
});

describe('applyMigrations integration (in-memory)', () => {
  it('executes a trigger-bearing migration end to end without choking on inner semicolons', async () => {
    // Drive a synthetic script through the splitter + a real libsql client to
    // prove each emitted statement is independently executable.
    const sql = `CREATE TABLE log (id INTEGER PRIMARY KEY AUTOINCREMENT, note TEXT);
CREATE TRIGGER stamp AFTER INSERT ON log
WHEN NEW.note IS NULL
BEGIN
  UPDATE log SET note = 'auto; generated' WHERE id = NEW.id;
END;`;
    const client = inMemoryClient();
    for (const stmt of splitSqlStatements(sql)) {
      await client.execute(stmt);
    }
    await client.execute("INSERT INTO log (note) VALUES (NULL)");
    const rows = await client.execute('SELECT note FROM log');
    expect(rows.rows[0]?.note).toBe('auto; generated');
  });
});
