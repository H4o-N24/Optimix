/**
 * 月次スケジューラ
 *
 * - 月末（25日〜）に翌月の空き日登録を促す通知を送信
 * - 月末最終日に日程が過ぎたイベントをまとめて削除
 */

import { type Client, type TextChannel } from 'discord.js';
import { PrismaClient } from '@prisma/client';
import { infoEmbed, successEmbed } from '../utils/embeds.js';

const prisma = new PrismaClient();

/** チェック間隔: 6時間ごと */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** 通知送信済みフラグ（同月内で1回のみ） */
let lastNotifiedMonth: string | null = null;
let lastCleanedMonth: string | null = null;

let schedulerTimer: NodeJS.Timeout | null = null;

/**
 * スケジューラを開始
 */
export function startMonthlyScheduler(client: Client): void {
    // 起動時にチェック
    runMonthlyTasks(client).catch((err) =>
        console.error('❌ 月次タスクエラー:', err),
    );

    // 6時間ごとにチェック
    schedulerTimer = setInterval(() => {
        runMonthlyTasks(client).catch((err) =>
            console.error('❌ 月次タスクエラー:', err),
        );
    }, CHECK_INTERVAL_MS);

    console.log('📅 月次スケジューラを開始しました（6時間ごとにチェック）');
}

/**
 * スケジューラを停止
 */
export function stopMonthlyScheduler(): void {
    if (schedulerTimer) {
        clearInterval(schedulerTimer);
        schedulerTimer = null;
    }
}

/**
 * 月次タスクの実行
 */
async function runMonthlyTasks(client: Client): Promise<void> {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1; // 1-indexed
    const day = now.getDate();
    const lastDay = new Date(year, month, 0).getDate();
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;

    // --- 月末通知（25日以降、月1回） ---
    if (day >= 25 && lastNotifiedMonth !== monthKey) {
        await sendAvailabilityReminder(client, year, month);
        lastNotifiedMonth = monthKey;
    }

    // --- 月末クリーンアップ（最終日、月1回） ---
    if (day === lastDay && lastCleanedMonth !== monthKey) {
        await cleanupPastEvents();
        lastCleanedMonth = monthKey;
    }
}

/**
 * 空き日登録リマインダーを全サーバーに送信
 */
async function sendAvailabilityReminder(client: Client, year: number, month: number): Promise<void> {
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;

    const guilds = await prisma.guild.findMany();

    for (const guild of guilds) {
        try {
            const discordGuild = await client.guilds.fetch(guild.guildId);

            // システムチャンネル or 最初のテキストチャンネル
            let channel: TextChannel | null = null;

            if (discordGuild.systemChannelId) {
                const ch = await discordGuild.channels.fetch(discordGuild.systemChannelId);
                if (ch?.isTextBased()) channel = ch as TextChannel;
            }

            if (!channel) {
                const channels = await discordGuild.channels.fetch();
                const textCh = channels.find((ch) => ch?.isTextBased() && !ch.isDMBased());
                if (textCh) channel = textCh as TextChannel;
            }

            if (!channel) continue;

            const embed = infoEmbed(
                `📅 ${nextYear}年${nextMonth}月の空き日を登録しましょう！`,
                [
                    '月末になりました！翌月の予定を登録して、スムーズな日程調整に備えましょう。',
                    '',
                    '**`/availability`** コマンドでカレンダーから空き日を選択できます。',
                    '',
                    '> 💡 みんなが空き日を登録するほど、最適な日程が見つかりやすくなります！',
                ].join('\n'),
            );

            await channel.send({ embeds: [embed] });
            console.log(`📮 空き日登録リマインダーを送信: ${discordGuild.name}`);
        } catch (err) {
            console.error(`⚠️ リマインダー送信失敗 (${guild.guildId}):`, err);
        }
    }
}

/**
 * 過去イベントの月末一括削除
 * 日程が確定済みで、今日の日付より前のイベントをすべて削除
 */
async function cleanupPastEvents(): Promise<void> {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    const pastEvents = await prisma.event.findMany({
        where: {
            date: { lt: today },
            status: 'CONFIRMED',
        },
    });

    if (pastEvents.length === 0) {
        console.log('🧹 月末クリーンアップ: 削除対象のイベントはありません');
        return;
    }

    await prisma.event.deleteMany({
        where: {
            date: { lt: today },
            status: 'CONFIRMED',
        },
    });

    const titles = pastEvents.map((e) => `  - ${e.title} (${e.date})`).join('\n');
    console.log(`🧹 月末クリーンアップ: ${pastEvents.length}件の過去イベントを削除\n${titles}`);
}
