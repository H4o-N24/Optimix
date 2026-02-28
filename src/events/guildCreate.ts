/**
 * guildCreate イベントハンドラ
 *
 * Botが新しいサーバーに参加したとき:
 * 1. Knot専用チャンネル（🗓｜knot-日程調整）を自動作成
 * 2. DBにguildId・botChannelIdを登録
 * 3. チャンネルにウェルカムメッセージを送信
 */

import { type Client, Events, ChannelType, type TextChannel, type Guild } from 'discord.js';
import { prisma } from '../lib/prisma.js';
import { infoEmbed } from '../utils/embeds.js';

const CHANNEL_NAME = '🗓｜knot-日程調整';
const CHANNEL_TOPIC = 'Knotで空き日を登録・イベントを管理しましょう | Powered by Knot';

const WELCOME_MESSAGE = [
    '👋 **Knotへようこそ！**',
    '',
    'このチャンネルでKnotのすべての操作ができます。',
    '',
    '**使い方:**',
    '📅 `/availability register` — 翌月の空き日を登録',
    '📊 `/availability status` — みんなの空き日を確認',
    '🎉 `/event create` — イベントを作成',
    '📋 `/event list` — イベント一覧',
    '⚙️ `/event manage` — イベント管理',
    '💰 `/premium status` — プラン確認',
    '📖 `/help` — 詳しい使い方',
    '',
    '> チャンネルを変更したい場合は `/setup channel channel:#チャンネル名` を実行してください。',
].join('\n');

export function registerGuildCreateHandler(client: Client): void {
    client.on(Events.GuildCreate, async (guild: Guild) => {
        try {
            // 既にDB登録済みで専用チャンネルが設定されていればスキップ
            const existing = await prisma.guild.findUnique({
                where: { guildId: guild.id },
                select: { botChannelId: true },
            });
            if (existing?.botChannelId) {
                console.log(`✅ サーバー参加 (既に設定済み): ${guild.name}`);
                return;
            }

            // 🗓｜knot-日程調整 チャンネルを作成
            let channel: TextChannel | null = null;
            try {
                channel = await guild.channels.create({
                    name: CHANNEL_NAME,
                    type: ChannelType.GuildText,
                    topic: CHANNEL_TOPIC,
                    reason: 'Knot 専用チャンネルの自動作成',
                }) as TextChannel;
            } catch {
                // チャンネル作成権限がない場合: システムチャンネルや既存チャンネルにフォールバック
                if (guild.systemChannelId) {
                    const ch = await guild.channels.fetch(guild.systemChannelId).catch(() => null);
                    if (ch?.isTextBased()) channel = ch as TextChannel;
                }
                if (!channel) {
                    const channels = await guild.channels.fetch();
                    const fallback = channels.find((ch) => ch?.isTextBased() && !ch.isDMBased());
                    if (fallback) channel = fallback as TextChannel;
                }
            }

            // DBに登録
            await prisma.guild.upsert({
                where: { guildId: guild.id },
                create: { guildId: guild.id, botChannelId: channel?.id ?? null },
                update: { botChannelId: channel?.id ?? null },
            });

            // ウェルカムメッセージを送信
            if (channel) {
                await channel.send({
                    embeds: [infoEmbed('👋 Knotへようこそ！', WELCOME_MESSAGE)],
                });
                console.log(`🎉 サーバー参加 & 専用チャンネル作成: ${guild.name} → #${channel.name}`);
            } else {
                console.log(`⚠️ サーバー参加 (チャンネル作成失敗): ${guild.name}`);
            }
        } catch (err) {
            console.error(`❌ guildCreate エラー (${guild.name}):`, err);
        }
    });
}
