/**
 * sql.js-based Prisma-compatible database layer for Android/nodejs-mobile.
 * Replaces @prisma/client with a pure-JS SQLite implementation.
 */

// @ts-nocheck
const initSqlJs = require('sql.js/dist/sql-asm.js');
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// ── State ────────────────────────────────────────────────────────────────────
let _db: any = null;
let _dbPath = '';
let _inTx = false;

// ── ID & time helpers ────────────────────────────────────────────────────────
function genId(): string {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).substring(2, 11);
  return 'c' + t + r;
}
function nowIso(): string { return new Date().toISOString(); }

// ── Persistence ──────────────────────────────────────────────────────────────
function persist(): void {
  if (_inTx) return;
  writeFileSync(_dbPath, Buffer.from(_db.export()));
}

// ── Low-level query helpers ──────────────────────────────────────────────────
function run(sql: string, params: any[] = []): void {
  _db.run(sql, params);
}

function getOne<T = Record<string, any>>(sql: string, params: any[] = []): T | null {
  const stmt = _db.prepare(sql);
  stmt.bind(params);
  let row: T | null = null;
  if (stmt.step()) row = coerceRow(stmt.getAsObject()) as T;
  stmt.free();
  return row;
}

function getAll<T = Record<string, any>>(sql: string, params: any[] = []): T[] {
  const stmt = _db.prepare(sql);
  stmt.bind(params);
  const rows: T[] = [];
  while (stmt.step()) rows.push(coerceRow(stmt.getAsObject()) as T);
  stmt.free();
  return rows;
}

// ── Type coercions ───────────────────────────────────────────────────────────
const BIGINT_COLS = new Set(['startedAt', 'endedAt', 'lastPracticeAt']);
const BOOL_COLS   = new Set(['isCurrent', 'checked', 'gentleRemind', 'recoveryEntry']);
const DATE_COLS   = new Set(['createdAt', 'updatedAt']);

function coerceRow(row: Record<string, any>): Record<string, any> {
  const r: Record<string, any> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === null || v === undefined) { r[k] = null; continue; }
    if (BIGINT_COLS.has(k)) { r[k] = BigInt(v as number); continue; }
    if (BOOL_COLS.has(k))   { r[k] = v === 1 || v === true; continue; }
    if (DATE_COLS.has(k))   { r[k] = new Date(v as string); continue; }
    r[k] = v;
  }
  return r;
}

function toSqlValue(k: string, v: any): any {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'bigint')  return Number(v);
  if (v instanceof Date)      return v.toISOString();
  return v;
}

// ── Query builders ───────────────────────────────────────────────────────────
function buildWhere(where: Record<string, any> = {}): { sql: string; params: any[] } {
  const parts: string[] = [];
  const params: any[] = [];
  for (const [k, v] of Object.entries(where)) {
    if (v === undefined) continue;
    if (v === null) { parts.push(`"${k}" IS NULL`); continue; }
    if (typeof v === 'object' && !(v instanceof Date) && typeof v !== 'bigint') {
      if ('gte' in v) { parts.push(`"${k}" >= ?`); params.push(toSqlValue(k, v.gte)); continue; }
      if ('lte' in v) { parts.push(`"${k}" <= ?`); params.push(toSqlValue(k, v.lte)); continue; }
      if ('gt'  in v) { parts.push(`"${k}" > ?`);  params.push(toSqlValue(k, v.gt));  continue; }
      if ('lt'  in v) { parts.push(`"${k}" < ?`);  params.push(toSqlValue(k, v.lt));  continue; }
    }
    parts.push(`"${k}" = ?`);
    params.push(toSqlValue(k, v));
  }
  return { sql: parts.length ? `WHERE ${parts.join(' AND ')}` : '', params };
}

function buildOrderBy(orderBy?: any): string {
  if (!orderBy) return '';
  const items = Array.isArray(orderBy) ? orderBy : [orderBy];
  return 'ORDER BY ' + items.flatMap(o => Object.entries(o).map(([k, d]) => `"${k}" ${String(d).toUpperCase()}`)).join(', ');
}

function buildSet(data: Record<string, any>): { sql: string; params: any[] } {
  const parts: string[] = [];
  const params: any[] = [];
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    if (typeof v === 'object' && v !== null && !(v instanceof Date) && typeof v !== 'bigint') {
      if ('increment' in v) { parts.push(`"${k}" = "${k}" + ?`); params.push(v.increment); continue; }
      if ('decrement' in v) { parts.push(`"${k}" = "${k}" - ?`); params.push(v.decrement); continue; }
    }
    parts.push(`"${k}" = ?`);
    params.push(toSqlValue(k, v));
  }
  parts.push(`"updatedAt" = ?`);
  params.push(nowIso());
  return { sql: parts.join(', '), params };
}

function applySelect(row: Record<string, any> | null, select?: Record<string, boolean>): any {
  if (!row || !select) return row;
  return Object.fromEntries(Object.entries(row).filter(([k]) => select[k]));
}

// ── Live includes ────────────────────────────────────────────────────────────
function attachIncludes(live: Record<string, any>, include?: Record<string, any>): Record<string, any> {
  if (!include) return live;
  const r = { ...live };
  if ('setlist'  in include) r.setlist  = getAll(`SELECT * FROM "SetlistItem"  WHERE liveShowId = ? ${buildOrderBy(include.setlist?.orderBy  ?? { order: 'asc' })}`,  [live.id]);
  if ('reviews'  in include) r.reviews  = getAll(`SELECT * FROM "LiveReview"   WHERE liveShowId = ? ${buildOrderBy(include.reviews?.orderBy  ?? { createdAt: 'desc' })}`, [live.id]);
  if ('fanNotes' in include) r.fanNotes = getAll(`SELECT * FROM "FanNote"      WHERE liveShowId = ? ${buildOrderBy(include.fanNotes?.orderBy ?? { createdAt: 'desc' })}`, [live.id]);
  return r;
}

// ── Generic model factory ────────────────────────────────────────────────────
function makeModel(table: string) {
  const isLive = table === 'LiveShow';

  function withIncludes(row: Record<string, any> | null, include?: Record<string, any>): any {
    if (!row) return null;
    return isLive ? attachIncludes(row, include) : row;
  }

  function insertRecord(data: Record<string, any>, id: string): void {
    const n = nowIso();
    const record: Record<string, any> = { id, ...data, createdAt: data.createdAt ?? n, updatedAt: n };
    const cols: string[] = [];
    const vals: any[] = [];
    for (const [k, v] of Object.entries(record)) {
      if (v === undefined) continue;
      cols.push(`"${k}"`);
      vals.push(toSqlValue(k, v));
    }
    run(`INSERT INTO "${table}" (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, vals);
  }

  return {
    async findUnique({ where, include, select }: any) {
      const { sql: w, params } = buildWhere(where);
      const row = getOne(`SELECT * FROM "${table}" ${w} LIMIT 1`, params);
      return applySelect(withIncludes(row, include), select);
    },
    async findFirst({ where, include, orderBy }: any = {}) {
      const { sql: w, params } = buildWhere(where);
      const row = getOne(`SELECT * FROM "${table}" ${w} ${buildOrderBy(orderBy)} LIMIT 1`, params);
      return withIncludes(row, include);
    },
    async findMany({ where, include, orderBy, skip, take }: any = {}) {
      const { sql: w, params } = buildWhere(where);
      const limit = take !== undefined ? `LIMIT ${take}${skip !== undefined ? ` OFFSET ${skip}` : ''}` : '';
      const rows = getAll(`SELECT * FROM "${table}" ${w} ${buildOrderBy(orderBy)} ${limit}`, params);
      return isLive ? rows.map(r => attachIncludes(r, include)) : rows;
    },
    async create({ data, include, select }: any) {
      const id = data.id ?? genId();
      insertRecord(data, id);
      persist();
      const row = getOne<Record<string, any>>(`SELECT * FROM "${table}" WHERE id = ?`, [id])!;
      return applySelect(withIncludes(row, include), select);
    },
    async update({ where, data, include }: any) {
      const { sql: w, params: wp } = buildWhere(where);
      const { sql: s, params: sp } = buildSet(data);
      run(`UPDATE "${table}" SET ${s} ${w}`, [...sp, ...wp]);
      persist();
      const row = getOne<Record<string, any>>(`SELECT * FROM "${table}" ${w} LIMIT 1`, wp)!;
      return withIncludes(row, include);
    },
    async updateMany({ where, data }: any) {
      const { sql: w, params: wp } = buildWhere(where);
      const { sql: s, params: sp } = buildSet(data);
      run(`UPDATE "${table}" SET ${s} ${w}`, [...sp, ...wp]);
      persist();
      return { count: _db.getRowsModified() };
    },
    async upsert({ where, create, update, include }: any) {
      const { sql: w, params } = buildWhere(where);
      const existing = getOne(`SELECT id FROM "${table}" ${w} LIMIT 1`, params);
      if (existing) return this.update({ where, data: update, include });
      return this.create({ data: { ...where, ...create }, include });
    },
    async delete({ where }: any) {
      const { sql: w, params } = buildWhere(where);
      const row = getOne(`SELECT * FROM "${table}" ${w} LIMIT 1`, params);
      run(`DELETE FROM "${table}" ${w}`, params);
      persist();
      return row;
    },
    async createMany({ data }: any) {
      const n = nowIso();
      for (const item of data as Record<string, any>[]) {
        const id = item.id ?? genId();
        const record: Record<string, any> = { id, ...item, createdAt: item.createdAt ?? n, updatedAt: n };
        const cols: string[] = [];
        const vals: any[] = [];
        for (const [k, v] of Object.entries(record)) {
          if (v === undefined) continue;
          cols.push(`"${k}"`);
          vals.push(toSqlValue(k, v));
        }
        run(`INSERT OR REPLACE INTO "${table}" (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, vals);
      }
      persist();
      return { count: data.length };
    },
    async deleteMany({ where }: any = {}) {
      const { sql: w, params } = buildWhere(where ?? {});
      run(`DELETE FROM "${table}" ${w}`, params);
      persist();
      return { count: _db.getRowsModified() };
    }
  };
}

// ── Schema creation ──────────────────────────────────────────────────────────
function createTables(): void {
  run(`CREATE TABLE IF NOT EXISTS "User" (
    id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL,
    passwordHash TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
  )`);
  run(`CREATE TABLE IF NOT EXISTS "Song" (
    id TEXT PRIMARY KEY, userId TEXT NOT NULL, legacyId TEXT, title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new', note TEXT, callGuide TEXT,
    callHints TEXT, mcKeywords TEXT,
    practiceCount INTEGER NOT NULL DEFAULT 0, retryCount INTEGER NOT NULL DEFAULT 0,
    passCount INTEGER NOT NULL DEFAULT 0, lastPractice TEXT, lastPracticeAt INTEGER,
    nextSongId TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
    FOREIGN KEY (userId) REFERENCES "User"(id) ON DELETE CASCADE,
    UNIQUE(userId, legacyId)
  )`);
  run(`CREATE INDEX IF NOT EXISTS idx_song_u ON "Song"(userId)`);
  run(`CREATE TABLE IF NOT EXISTS "LiveShow" (
    id TEXT PRIMARY KEY, userId TEXT NOT NULL, name TEXT NOT NULL,
    date TEXT NOT NULL, venue TEXT NOT NULL, isCurrent INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
    FOREIGN KEY (userId) REFERENCES "User"(id) ON DELETE CASCADE
  )`);
  run(`CREATE INDEX IF NOT EXISTS idx_live_u ON "LiveShow"(userId, isCurrent)`);
  run(`CREATE TABLE IF NOT EXISTS "SetlistItem" (
    id TEXT PRIMARY KEY, liveShowId TEXT NOT NULL, role TEXT, song TEXT NOT NULL,
    "order" INTEGER NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
    FOREIGN KEY (liveShowId) REFERENCES "LiveShow"(id) ON DELETE CASCADE,
    UNIQUE(liveShowId, "order")
  )`);
  run(`CREATE TABLE IF NOT EXISTS "LiveReview" (
    id TEXT PRIMARY KEY, liveShowId TEXT NOT NULL, feeling TEXT,
    buppan TEXT, note TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
    FOREIGN KEY (liveShowId) REFERENCES "LiveShow"(id) ON DELETE CASCADE
  )`);
  run(`CREATE TABLE IF NOT EXISTS "FanNote" (
    id TEXT PRIMARY KEY, liveShowId TEXT NOT NULL, name TEXT NOT NULL,
    tag TEXT, note TEXT, lastSeen TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
    FOREIGN KEY (liveShowId) REFERENCES "LiveShow"(id) ON DELETE CASCADE
  )`);
  run(`CREATE TABLE IF NOT EXISTS "TrainingSession" (
    id TEXT PRIMARY KEY, userId TEXT NOT NULL, legacyId TEXT, songId TEXT,
    songTitle TEXT NOT NULL, startedAt INTEGER NOT NULL, endedAt INTEGER,
    duration INTEGER NOT NULL DEFAULT 0, passes INTEGER NOT NULL DEFAULT 0,
    retries INTEGER NOT NULL DEFAULT 0, events TEXT,
    createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
    FOREIGN KEY (userId) REFERENCES "User"(id) ON DELETE CASCADE,
    UNIQUE(userId, legacyId)
  )`);
  run(`CREATE INDEX IF NOT EXISTS idx_sess_u ON "TrainingSession"(userId, startedAt)`);
  run(`CREATE TABLE IF NOT EXISTS "PerformanceLog" (
    id TEXT PRIMARY KEY, userId TEXT NOT NULL, songId TEXT, liveShowId TEXT,
    reactionScore INTEGER NOT NULL, callScore INTEGER NOT NULL, selfScore INTEGER NOT NULL,
    createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
    FOREIGN KEY (userId) REFERENCES "User"(id) ON DELETE CASCADE
  )`);
  run(`CREATE INDEX IF NOT EXISTS idx_perf_u ON "PerformanceLog"(userId, songId)`);
  run(`CREATE TABLE IF NOT EXISTS "ReflectionScore" (
    id TEXT PRIMARY KEY, userId TEXT NOT NULL, key TEXT NOT NULL,
    score INTEGER NOT NULL, note TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
    FOREIGN KEY (userId) REFERENCES "User"(id) ON DELETE CASCADE,
    UNIQUE(userId, key)
  )`);
  run(`CREATE TABLE IF NOT EXISTS "UserSettings" (
    id TEXT PRIMARY KEY, userId TEXT UNIQUE NOT NULL,
    gentleRemind INTEGER NOT NULL DEFAULT 1, recoveryEntry INTEGER NOT NULL DEFAULT 1,
    themeIdx INTEGER NOT NULL DEFAULT 0, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
    FOREIGN KEY (userId) REFERENCES "User"(id) ON DELETE CASCADE
  )`);
  run(`CREATE TABLE IF NOT EXISTS "IdolCheck" (
    id TEXT PRIMARY KEY, userId TEXT NOT NULL, key TEXT NOT NULL,
    checked INTEGER NOT NULL DEFAULT 0, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
    FOREIGN KEY (userId) REFERENCES "User"(id) ON DELETE CASCADE,
    UNIQUE(userId, key)
  )`);
  run(`CREATE TABLE IF NOT EXISTS "UserCondition" (
    id TEXT PRIMARY KEY, userId TEXT UNIQUE NOT NULL, value TEXT,
    createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
    FOREIGN KEY (userId) REFERENCES "User"(id) ON DELETE CASCADE
  )`);
}

// ── Public API ───────────────────────────────────────────────────────────────
export async function initDatabase(dbPath: string): Promise<void> {
  const SQL = await initSqlJs();
  _dbPath = dbPath;
  const dir = dirname(dbPath);
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  const buf = existsSync(dbPath) ? readFileSync(dbPath) : null;
  _db = new SQL.Database(buf ?? undefined);
  run('PRAGMA foreign_keys = ON');
  createTables();
  persist();
}

export const prisma = {
  user:            makeModel('User'),
  song:            makeModel('Song'),
  liveShow:        makeModel('LiveShow'),
  setlistItem:     makeModel('SetlistItem'),
  liveReview:      makeModel('LiveReview'),
  fanNote:         makeModel('FanNote'),
  trainingSession: makeModel('TrainingSession'),
  performanceLog:  makeModel('PerformanceLog'),
  reflectionScore: makeModel('ReflectionScore'),
  userSettings:    makeModel('UserSettings'),
  idolCheck:       makeModel('IdolCheck'),
  userCondition:   makeModel('UserCondition'),

  async $transaction<T>(fn: (tx: typeof prisma) => Promise<T>): Promise<T> {
    run('BEGIN');
    _inTx = true;
    try {
      const result = await fn(prisma);
      run('COMMIT');
      _inTx = false;
      persist();
      return result;
    } catch (e) {
      run('ROLLBACK');
      _inTx = false;
      throw e;
    }
  },

  $disconnect: async () => { if (_db) persist(); }
};
