# StageBuddy Backend Local

适配 `StageBuddy v2.42` 的本地后端，目标：

- 本地单机立即可跑
- 不依赖 Redis / Postgres
- 默认 SQLite
- 保留前端现有 localStorage 数据结构，支持 `/api/sync/push` 与 `/api/sync/pull`
- 兼容前端当前状态键：
  - `stagebuddy_theme_idx`
  - `stagebuddy_songs`
  - `stagebuddy_live`
  - `stagebuddy_sessions`
  - `stagebuddy_settings`
  - `stagebuddy_idol_checks`
  - `stagebuddy_condition`
  - `stagebuddy_perflogs`
  - `stagebuddy_reflscores`

## 运行

```bash
cp .env.example .env
npm install
npm run db:generate
npm run db:push
npm run dev
```

默认监听：

- `http://127.0.0.1:3300`

健康检查：

- `GET /api/health`

## 首次使用

1. `POST /api/auth/register`
2. 拿到 `accessToken`
3. 前端请求时带：
   - `Authorization: Bearer <token>`
4. 首次迁移本地数据：
   - `POST /api/sync/push`
5. 以后多端恢复：
   - `GET /api/sync/pull`

## 已实现端点

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/sync/pull`
- `POST /api/sync/push`
- `GET/POST/PATCH/DELETE /api/songs`
- `POST /api/songs/:id/cycle-status`
- `POST /api/songs/:id/practice`
- `GET/PUT /api/live/current`
- `PUT /api/live/current/setlist`
- `POST /api/live/current/review`
- `GET /api/live/history`
- `GET /api/sessions`
- `POST /api/sessions/start`
- `PATCH /api/sessions/:id/end`
- `POST /api/sessions/:id/event`
- `GET /api/sessions/stats/week`
- `GET/POST /api/performance`
- `GET /api/reflection`
- `PUT /api/reflection/:key`
- `DELETE /api/reflection/:key`
- `GET/PUT /api/settings`
- `PUT /api/condition`
- `PUT /api/idol-checks`
- `GET/POST/PATCH/DELETE /api/fans`

## 前端接入建议

### 1. 登录后保存 token

```ts
localStorage.setItem('stagebuddy_token', accessToken);
```

### 2. 统一请求封装

```ts
const API_BASE = 'http://127.0.0.1:3300';

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('stagebuddy_token');
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) throw new Error(await res.text());
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
```

### 3. 初始化时拉取远端

```ts
const remote = await api('/api/sync/pull');
safeSave('stagebuddy_theme_idx', remote.themeIdx);
safeSave('stagebuddy_songs', remote.songs);
safeSave('stagebuddy_live', remote.nextLive);
safeSave('stagebuddy_sessions', remote.trainingSessions);
safeSave('stagebuddy_settings', remote.settings);
safeSave('stagebuddy_idol_checks', remote.idolChecks);
safeSave('stagebuddy_condition', remote.condition);
safeSave('stagebuddy_perflogs', remote.performanceLogs);
safeSave('stagebuddy_reflscores', remote.reflectionScores);
```

### 4. 本地首包迁移

```ts
await api('/api/sync/push', {
  method: 'POST',
  body: JSON.stringify({
    songs: safeLoad('stagebuddy_songs', []),
    nextLive: safeLoad('stagebuddy_live', { name: '', date: '', venue: '', setlist: [], fanNotes: [], reviews: [] }),
    trainingSessions: safeLoad('stagebuddy_sessions', []),
    settings: safeLoad('stagebuddy_settings', { gentleRemind: true, recoveryEntry: true }),
    idolChecks: safeLoad('stagebuddy_idol_checks', {}),
    condition: safeLoad('stagebuddy_condition', null),
    performanceLogs: safeLoad('stagebuddy_perflogs', []),
    reflectionScores: safeLoad('stagebuddy_reflscores', {}),
    themeIdx: safeLoad('stagebuddy_theme_idx', 0)
  })
});
```

## 设计取舍

- **数据库**：SQLite，适合本地单机和轻应用
- **鉴权**：7 天 JWT，避免本地环境再引入 refresh token / Redis
- **同步模型**：数据库内部是关系表，`pull/push` 输出仍然是前端当前 localStorage 结构
- **兼容性**：保留 `songs / nextLive / trainingSessions / settings / idolChecks / condition / performanceLogs / reflectionScores / themeIdx`

## 注意事项

- SQLite 适合本地单机，不适合高并发多实例部署
- `JWT_SECRET` 必须改成自己的强随机串
- `CORS_ORIGIN` 需要按你的前端开发地址配置
- `sync/push` 当前策略是“以客户端上传为准”，适合本地迁移和单人使用
