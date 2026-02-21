/**
 * /setup コマンド - Knot専用チャンネルのセットアップ
 *
 * サブコマンド:
 * - /setup channel: 専用チャンネルを作成してKnotのやり取りを限定
 * - /setup reset: チャンネル制限を解除（どこでも使えるように戻す）
 */

import {
    SlashCommandBuilder,
    type ChatInputCommandInteraction,
    ChannelType,
    PermissionFlagsBits,
    type TextChannel,
} from 'discord.js';
import { prisma } from '../lib/prisma.js';
import { successEmbed, infoEmbed, errorEmbed } from '../utils/embeds.js';

const CHANNEL_NAME = '🗓｜knot-日程調整';
const CHANNEL_TOPIC = '/availability で空き日を登録 | /event でイベントを管理 | Powered by Knot';

export const data = new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Knotの初期設定を行います（管理者のみ）')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addSubcommand((sub) =>
        sub
            .setName('channel')
            .setDescription('Knot専用チャンネルを作成し、やり取りをそこに限定します'),
    )
    .addSubcommand((sub) =>
        sub
            .setName('reset')
            .setDescription('チャンネル制限を解除し、どのチャンネルからでも使えるように戻します'),
    );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'channel') {
        await handleSetupChannel(interaction);
    } else if (subcommand === 'reset') {
        await handleReset(interaction);
    }
}

async function handleSetupChannel(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const guild = interaction.guild;
    const guildId = interaction.guildId;
    if (!guild || !guildId) {
        await interaction.editReply({ embeds: [errorEmbed('エラー', 'サーバー内でのみ使用できます。')] });
        return;
    }

    // 既存のチャンネル設定を確認
    const guildRecord = await prisma.guild.findUnique({ where: { guildId } });
    if (guildRecord?.botChannelId) {
        const existing = guild.channels.cache.get(guildRecord.botChannelId);
        if (existing) {
            await interaction.editReply({
                embeds: [infoEmbed(
                    'セットアップ済み',
                    `Knotの専用チャンネルは既に設定されています。\n\n` +
                    `📌 専用チャンネル: <#${guildRecord.botChannelId}>\n\n` +
                    `制限を解除したい場合は \`/setup reset\` を実行してください。`,
                )],
            });
            return;
        }
    }

    // チャンネルを作成
    let channel: TextChannel;
    try {
        channel = await guild.channels.create({
            name: CHANNEL_NAME,
            type: ChannelType.GuildText,
            topic: CHANNEL_TOPIC,
            reason: 'Knot専用チャンネルのセットアップ',
        }) as TextChannel;
    } catch {
        await interaction.editReply({
            embeds: [errorEmbed('チャンネル作成失敗', 'チャンネルの作成に失敗しました。Botに「チャンネルの管理」権限があるか確認してください。')],
        });
        return;
    }

    // DBにチャンネルIDを保存
    await prisma.guild.upsert({
        where: { guildId },
        create: { guildId, botChannelId: channel.id },
        update: { botChannelId: channel.id },
    });

    // 専用チャンネルにウェルカムメッセージを投稿
    await channel.send({
        embeds: [infoEmbed(
            '👋 Knot へようこそ！',
            'このチャンネルはKnot Botの専用チャンネルです。\n\n' +
            '**できること:**\n' +
            '📅 `/availability register` — 翌月の空き日を登録\n' +
            '📊 `/availability status` — みんなの空き日を確認\n' +
            '🎉 `/event create` — イベントを作成\n' +
            '📋 `/event list` — イベント一覧を表示\n' +
            '⚙️ `/event manage` — イベントを管理\n' +
            '📖 `/help` — 詳しい使い方を確認',
        )],
    });

    await interaction.editReply({
        embeds: [successEmbed(
            'セットアップ完了',
            `専用チャンネル <#${channel.id}> を作成しました！\n\n` +
            `これ以降、Knotのコマンドは <#${channel.id}> でのみ使用できます。`,
        )],
    });
}

async function handleReset(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const guildId = interaction.guildId;
    if (!guildId) {
        await interaction.editReply({ embeds: [errorEmbed('エラー', 'サーバー内でのみ使用できます。')] });
        return;
    }

    await prisma.guild.upsert({
        where: { guildId },
        create: { guildId, botChannelId: null },
        update: { botChannelId: null },
    });

    await interaction.editReply({
        embeds: [successEmbed(
            'チャンネル制限を解除',
            'どのチャンネルからでもKnotのコマンドを使用できるようになりました。',
        )],
    });
}
