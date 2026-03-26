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

- `http://0.0.0.0:3300`（所有网络接口）
- Android 模拟器访问地址：`http://10.0.2.2:3300`
- Android 真机访问地址：`http://<宿主机局域网IP>:3300`

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

## Android 接入指南

### 连接地址

| 场景 | API Base URL |
|------|-------------|
| Android 模拟器 | `http://10.0.2.2:3300` |
| Android 真机（同局域网） | `http://<宿主机IP>:3300` |

### 依赖（build.gradle）

```gradle
implementation 'com.squareup.retrofit2:retrofit:2.9.0'
implementation 'com.squareup.retrofit2:converter-gson:2.9.0'
implementation 'com.squareup.okhttp3:logging-interceptor:4.12.0'
```

### OkHttp 客户端封装

```kotlin
object ApiClient {
    private const val BASE_URL = "http://10.0.2.2:3300" // 模拟器；真机改为宿主机 IP

    private val prefs by lazy {
        App.context.getSharedPreferences("stagebuddy", Context.MODE_PRIVATE)
    }

    private val okHttp = OkHttpClient.Builder()
        .addInterceptor { chain ->
            val token = prefs.getString("access_token", null)
            val req = if (token != null) {
                chain.request().newBuilder()
                    .addHeader("Authorization", "Bearer $token")
                    .build()
            } else chain.request()
            chain.proceed(req)
        }
        .build()

    val retrofit: Retrofit = Retrofit.Builder()
        .baseUrl("$BASE_URL/")
        .client(okHttp)
        .addConverterFactory(GsonConverterFactory.create())
        .build()
}
```

### Retrofit 接口定义

```kotlin
interface StageBuddyApi {
    // 鉴权
    @POST("api/auth/register")
    suspend fun register(@Body body: AuthBody): AuthResponse

    @POST("api/auth/login")
    suspend fun login(@Body body: AuthBody): AuthResponse

    @GET("api/auth/me")
    suspend fun me(): MeResponse

    // 数据同步
    @GET("api/sync/pull")
    suspend fun pull(): SyncPayload

    @POST("api/sync/push")
    suspend fun push(@Body payload: SyncPayload): SyncPayload

    // 曲目
    @GET("api/songs")
    suspend fun getSongs(): List<Song>

    @POST("api/songs")
    suspend fun createSong(@Body body: SongBody): Song

    @PATCH("api/songs/{id}")
    suspend fun updateSong(@Path("id") id: String, @Body body: SongBody): Song

    @DELETE("api/songs/{id}")
    suspend fun deleteSong(@Path("id") id: String): Response<Unit>

    @POST("api/songs/{id}/cycle-status")
    suspend fun cycleSongStatus(@Path("id") id: String): Song

    @POST("api/songs/{id}/practice")
    suspend fun practiceSong(@Path("id") id: String): Song

    // Live
    @GET("api/live/current")
    suspend fun getCurrentLive(): LiveShow

    @PUT("api/live/current")
    suspend fun updateCurrentLive(@Body body: LiveBody): LiveShow

    @PUT("api/live/current/setlist")
    suspend fun updateSetlist(@Body body: SetlistBody): LiveShow

    @POST("api/live/current/review")
    suspend fun addReview(@Body body: ReviewBody): LiveReview

    @GET("api/live/history")
    suspend fun getLiveHistory(): List<LiveShow>

    // 设置 & 状态
    @GET("api/settings")
    suspend fun getSettings(): UserSettings

    @PUT("api/settings")
    suspend fun updateSettings(@Body body: UserSettings): UserSettings

    @PUT("api/condition")
    suspend fun updateCondition(@Body body: ConditionBody): UserCondition

    @PUT("api/idol-checks")
    suspend fun updateIdolChecks(@Body body: Map<String, Boolean>): Map<String, Boolean>

    // 粉丝
    @GET("api/fans")
    suspend fun getFans(): List<Fan>

    @POST("api/fans")
    suspend fun createFan(@Body body: FanBody): Fan
}
```

### 首次登录 & Token 存储

```kotlin
suspend fun login(email: String, password: String) {
    val api = ApiClient.retrofit.create(StageBuddyApi::class.java)
    val resp = api.login(AuthBody(email, password))
    prefs.edit().putString("access_token", resp.accessToken).apply()
}
```

### 数据同步流程

```kotlin
// 启动时拉取远端数据
suspend fun syncFromRemote() {
    val payload = api.pull()
    // 保存到本地 Room / SharedPreferences
    localDb.saveAll(payload)
}

// 本地数据首次推送到服务器
suspend fun pushLocalData() {
    val payload = buildSyncPayload() // 从本地数据库组装
    api.push(payload)
}
```

### AndroidManifest.xml 权限

```xml
<uses-permission android:name="android.permission.INTERNET" />
```

如连接 HTTP（非 HTTPS）还需在 `res/xml/network_security_config.xml` 中允许明文流量：

```xml
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="false">10.0.2.2</domain>
        <!-- 真机调试时补充宿主机局域网 IP -->
    </domain-config>
</network-security-config>
```

```xml
<!-- AndroidManifest.xml application 标签内 -->
android:networkSecurityConfig="@xml/network_security_config"
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
