import { prisma } from '../lib/prisma.js';

export function fromJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

export function toJson(value: unknown): string {
  return JSON.stringify(value);
}

export function relativePracticeText(timestamp?: number | null): string {
  if (!timestamp) return '刚刚';
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return '刚刚';
  if (mins < 60) return `${mins}分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days === 1) return '昨天';
  return `${days}天前`;
}

export function normalizeSongStatus(status?: string | null): string {
  switch ((status ?? '').toLowerCase()) {
    case 'almost': return 'almost';
    case 'smooth': return 'smooth';
    default: return 'new';
  }
}

export function cycleSongStatus(status: string): string {
  if (status === 'new') return 'almost';
  if (status === 'almost') return 'smooth';
  return 'new';
}

export async function ensureCurrentLive(userId: string) {
  const existing = await prisma.liveShow.findFirst({
    where: { userId, isCurrent: true },
    include: { setlist: { orderBy: { order: 'asc' } }, reviews: { orderBy: { createdAt: 'desc' } }, fanNotes: { orderBy: { createdAt: 'desc' } } }
  });
  if (existing) return existing;
  return prisma.liveShow.create({
    data: {
      userId,
      isCurrent: true,
      name: '未命名 Live',
      date: '',
      venue: ''
    },
    include: { setlist: { orderBy: { order: 'asc' } }, reviews: { orderBy: { createdAt: 'desc' } }, fanNotes: { orderBy: { createdAt: 'desc' } } }
  });
}

export async function ensureUserDefaults(userId: string): Promise<void> {
  await prisma.userSettings.upsert({
    where: { userId },
    create: { userId, gentleRemind: true, recoveryEntry: true, themeIdx: 0 },
    update: {}
  });
  await prisma.userCondition.upsert({
    where: { userId },
    create: { userId, value: null },
    update: {}
  });
  await ensureCurrentLive(userId);
}

export async function buildPullPayload(userId: string) {
  await ensureUserDefaults(userId);

  const [songs, live, sessions, settings, idolChecks, condition, performanceLogs, reflectionScores] = await Promise.all([
    prisma.song.findMany({ where: { userId }, orderBy: [{ createdAt: 'asc' }] }),
    ensureCurrentLive(userId),
    prisma.trainingSession.findMany({ where: { userId }, orderBy: [{ startedAt: 'desc' }] }),
    prisma.userSettings.findUnique({ where: { userId } }),
    prisma.idolCheck.findMany({ where: { userId } }),
    prisma.userCondition.findUnique({ where: { userId } }),
    prisma.performanceLog.findMany({ where: { userId }, orderBy: [{ createdAt: 'desc' }] }),
    prisma.reflectionScore.findMany({ where: { userId } })
  ]);

  return {
    songs: songs.map((item) => ({
      id: item.legacyId && /^\d+$/.test(item.legacyId) ? Number(item.legacyId) : item.id,
      title: item.title,
      status: item.status,
      note: item.note ?? '',
      practiceCount: item.practiceCount,
      retryCount: item.retryCount,
      passCount: item.passCount,
      callGuide: item.callGuide ?? '',
      callHints: fromJson(item.callHints, []),
      mcKeywords: fromJson(item.mcKeywords, []),
      nextSongId: item.nextSongId ?? null,
      lastPractice: item.lastPractice ?? '刚刚',
      lastPracticeAt: item.lastPracticeAt ? Number(item.lastPracticeAt) : null
    })),
    nextLive: {
      name: live.name,
      date: live.date,
      venue: live.venue,
      setlist: live.setlist.map((item) => ({ role: item.role ?? '', song: item.song })),
      fanNotes: live.fanNotes.map((item) => ({
        id: item.id,
        liveShowId: live.id,
        name: item.name,
        tag: item.tag ?? '',
        note: item.note ?? '',
        lastSeen: item.lastSeen ?? ''
      })),
      reviews: live.reviews.map((item) => ({
        id: item.id,
        feeling: item.feeling ?? null,
        buppan: fromJson(item.buppan, { cheki: 0, sign: 0 }),
        note: item.note ?? '',
        createdAt: item.createdAt.toISOString()
      }))
    },
    trainingSessions: sessions.map((item) => ({
      id: item.legacyId ?? item.id,
      songId: item.songId,
      songTitle: item.songTitle,
      startedAt: Number(item.startedAt),
      endedAt: item.endedAt ? Number(item.endedAt) : null,
      duration: item.duration,
      passes: item.passes,
      retries: item.retries,
      events: fromJson(item.events, [])
    })),
    settings: {
      gentleRemind: settings?.gentleRemind ?? true,
      recoveryEntry: settings?.recoveryEntry ?? true
    },
    idolChecks: Object.fromEntries(idolChecks.map((item) => [item.key, item.checked])),
    condition: condition?.value ?? null,
    performanceLogs: performanceLogs.map((item) => ({
      id: item.id,
      songId: item.songId,
      liveShowId: item.liveShowId,
      reactionScore: item.reactionScore,
      callScore: item.callScore,
      selfScore: item.selfScore,
      createdAt: item.createdAt.toISOString()
    })),
    reflectionScores: Object.fromEntries(reflectionScores.map((item) => [item.key, { score: item.score, note: item.note ?? '' }])),
    themeIdx: settings?.themeIdx ?? 0
  };
}
