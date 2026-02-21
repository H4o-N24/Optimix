/**
 * 最適日抽出アルゴリズム (Scheduler Service)
 *
 * 設計書のアルゴリズムに準拠:
 * 1. 期間内の Availability を date ごとに集計
 * 2. 必須メンバーが全員 status=Available な日をフィルタ
 * 3. 参加可能人数で降順ソート
 * 4. min_participants 未満を除外
 * 5. 上位3件を返却
 */

import { PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

export interface ScheduleCandidate {
    date: string;
    count: number;
    members: string[]; // Discord User IDs
    tags: string[];    // おすすめ理由タグ (例: ['🏆 全員参加可能', '📅 平日'])
}

export interface FindOptimalDatesOptions {
    guildId: string;
    startDate: string; // YYYY-MM-DD
    endDate: string;   // YYYY-MM-DD
    requiredUserIds?: string[];
    minParticipants?: number;
    dayOfWeekFilter?: number[]; // 0=日, 1=月, ..., 6=土
    limit?: number;
    totalRegisteredUsers?: number; // サーバーの空き日登録者数（全員参加判定用）
}

/**
 * 最適な日程候補を抽出する
 */
export async function findOptimalDates(
    options: FindOptimalDatesOptions,
): Promise<ScheduleCandidate[]> {
    const {
        guildId,
        startDate,
        endDate,
        requiredUserIds = [],
        minParticipants = 1,
        dayOfWeekFilter,
        limit = 5,
        totalRegisteredUsers,
    } = options;

    // 1. 期間内の空き日を取得
    const availabilities = await prisma.availability.findMany({
        where: {
            guildId,
            status: 'AVAILABLE',
            date: {
                gte: startDate,
                lte: endDate,
            },
        },
        select: {
            date: true,
            userId: true,
        },
    });

    // 実際の登録者数（引数で渡されていない場合はDBから計算）
    const uniqueUsers = new Set(availabilities.map((a) => a.userId));
    const registeredCount = totalRegisteredUsers ?? uniqueUsers.size;

    // 2. 日付ごとに集計
    const dateMap = new Map<string, string[]>();
    for (const av of availabilities) {
        const members = dateMap.get(av.date) ?? [];
        members.push(av.userId);
        dateMap.set(av.date, members);
    }

    // 3. 候補日のフィルタリングとソート
    let candidates: ScheduleCandidate[] = [];

    for (const [date, members] of dateMap) {
        // 曜日フィルター
        const dow = new Date(date + 'T00:00:00').getDay();
        if (dayOfWeekFilter && dayOfWeekFilter.length > 0) {
            if (!dayOfWeekFilter.includes(dow)) continue;
        }

        // 必須メンバーチェック
        if (requiredUserIds.length > 0) {
            const allRequired = requiredUserIds.every((uid) => members.includes(uid));
            if (!allRequired) continue;
        }

        // 最低人数チェック
        if (members.length < minParticipants) continue;

        // おすすめ理由タグを生成
        const tags: string[] = [];
        if (registeredCount > 0 && members.length >= registeredCount) tags.push('🏆 全員参加可能');
        if (members.length >= minParticipants * 2) tags.push('👥 参加者多数');
        if (requiredUserIds.length > 0 && requiredUserIds.every((uid) => members.includes(uid))) tags.push('✅ 必須メンバー全員空き');
        if (dow >= 1 && dow <= 5) tags.push('📅 平日');
        if (dow === 0 || dow === 6) tags.push('🏖️ 週末');

        candidates.push({
            date,
            count: members.length,
            members,
            tags,
        });
    }

    // 4. 参加可能人数の降順でソート
    candidates.sort((a, b) => b.count - a.count);

    // 5. 上位N件を返却
    return candidates.slice(0, limit);
}

/**
 * テスト用: Prisma を使わない純粋関数版の最適日抽出
 * ユニットテストで使用
 */
export function findOptimalDatesFromData(
    availabilities: { date: string; userId: string }[],
    options: {
        requiredUserIds?: string[];
        minParticipants?: number;
        dayOfWeekFilter?: number[];
        limit?: number;
    },
): ScheduleCandidate[] {
    const {
        requiredUserIds = [],
        minParticipants = 1,
        dayOfWeekFilter,
        limit = 3,
    } = options;

    // 日付ごとに集計
    const dateMap = new Map<string, string[]>();
    for (const av of availabilities) {
        const members = dateMap.get(av.date) ?? [];
        members.push(av.userId);
        dateMap.set(av.date, members);
    }

    const uniqueUsers = new Set(availabilities.map((a) => a.userId));
    const registeredCount = uniqueUsers.size;

    let candidates: ScheduleCandidate[] = [];

    for (const [date, members] of dateMap) {
        const dow = new Date(date + 'T00:00:00').getDay();
        if (dayOfWeekFilter && dayOfWeekFilter.length > 0) {
            if (!dayOfWeekFilter.includes(dow)) continue;
        }
        if (requiredUserIds.length > 0) {
            const allRequired = requiredUserIds.every((uid) => members.includes(uid));
            if (!allRequired) continue;
        }
        if (members.length < minParticipants) continue;

        const tags: string[] = [];
        if (registeredCount > 0 && members.length >= registeredCount) tags.push('🏆 全員参加可能');
        if (members.length >= minParticipants * 2) tags.push('👥 参加者多数');
        if (requiredUserIds.length > 0 && requiredUserIds.every((uid) => members.includes(uid))) tags.push('✅ 必須メンバー全員空き');
        if (dow >= 1 && dow <= 5) tags.push('📅 平日');
        if (dow === 0 || dow === 6) tags.push('🏖️ 週末');

        candidates.push({ date, count: members.length, members, tags });
    }

    candidates.sort((a, b) => b.count - a.count);
    return candidates.slice(0, limit);
}
