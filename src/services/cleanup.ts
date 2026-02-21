/**
 * 月次スケジューラ
 *
 * - 月末（25日〜）に翌月の空き日登録を促す通知を送信
 * - 月末最終日に過去イベントをアーカイブ（削除ではなく保管）
 */

import { type Client, type TextChannel } from 'discord.js';
import { prisma } from '../lib/prisma.js';
import { infoEmbed } from '../utils/embeds.js';

/** チェック間隔: 6時間ごと */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

let lastNotifiedMonth: string | null = null;
let lastArchivedMonth: string | null = null;
let schedulerTimer: NodeJS.Timeout | null = null;

export function startMonthlyScheduler(client: Client): void {
    runMonthlyTasks(client).catch((err) =>
        console.error('❌ 月次タスクエラー:', err),
    );

    schedulerTimer = setInterval(() => {
        runMonthlyTasks(client).catch((err) =>
            console.error('❌ 月次タスクエラー:', err),
        );
    }, CHECK_INTERVAL_MS);

    console.log('📅 月次スケジューラを開始しました（6時間ごとにチェック）');
}

export function stopMonthlyScheduler(): void {
    if (schedulerTimer) {
        clearInterval(schedulerTimer);
        schedulerTimer = null;
    }
}

async function runMonthlyTasks(client: Client): Promise<void> {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const day = now.getDate();
    const lastDay = new Date(year, month, 0).getDate();
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;

    // 月末通知（25日以降、月1回）
    if (day >= 25 && lastNotifiedMonth !== monthKey) {
        await sendAvailabilityReminder(client, year, month);
        lastNotifiedMonth = monthKey;
    }

    // 月末アーカイブ（最終日、月1回）
    if (day === lastDay && lastArchivedMonth !== monthKey) {
        await archivePastEvents();
        lastArchivedMonth = monthKey;
    }
}

async function sendAvailabilityReminder(client: Client, year: number, month: number): Promise<void> {
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;

    const guilds = await prisma.guild.findMany();

    for (const guild of guilds) {
        try {
            const discordGuild = await client.guilds.fetch(guild.guildId);

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
 * 過去イベントをアーカイブ（削除ではなくステータス変更）
 */
async function archivePastEvents(): Promise<void> {
    const today = new Date().toISOString().split('T')[0];

    const result = await prisma.event.updateMany({
        where: {
            date: { lt: today },
            status: 'CONFIRMED',
        },
        data: {
            status: 'ARCHIVED',
        },
    });

    if (result.count > 0) {
        console.log(`📦 月末アーカイブ: ${result.count}件の過去イベントをアーカイブしました`);
    } else {
        console.log('📦 月末アーカイブ: アーカイブ対象のイベントはありません');
    }
}
