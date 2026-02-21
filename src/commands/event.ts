/**
 * /event コマンド - イベント作成・管理
 *
 * サブコマンド:
 * - /event create: 条件付きイベント作成 + 最適日抽出
 * - /event list: イベント一覧表示
 * - /event manage: イベント管理（詳細表示・編集・削除を統合）
 */

import {
    SlashCommandBuilder,
    type ChatInputCommandInteraction,
    type AutocompleteInteraction,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
} from 'discord.js';
import { PrismaClient } from '@prisma/client';
import { findOptimalDates } from '../services/scheduler.js';
import { candidateEmbed, successEmbed, infoEmbed, errorEmbed } from '../utils/embeds.js';
import { formatDateJP } from '../utils/date.js';

const prisma = new PrismaClient();

export const data = new SlashCommandBuilder()
    .setName('event')
    .setDescription('イベントを管理します')
    .addSubcommand((sub) =>
        sub
            .setName('create')
            .setDescription('新しいイベントを作成します')
            .addStringOption((opt) =>
                opt.setName('title').setDescription('イベント名').setRequired(true),
            )
            .addIntegerOption((opt) =>
                opt.setName('min').setDescription('最低参加人数').setRequired(false),
            )
            .addIntegerOption((opt) =>
                opt.setName('max').setDescription('定員（上限）').setRequired(false),
            )
            .addUserOption((opt) =>
                opt.setName('required1').setDescription('必須メンバー1').setRequired(false),
            )
            .addUserOption((opt) =>
                opt.setName('required2').setDescription('必須メンバー2').setRequired(false),
            )
            .addUserOption((opt) =>
                opt.setName('required3').setDescription('必須メンバー3').setRequired(false),
            )
            .addStringOption((opt) =>
                opt
                    .setName('dayfilter')
                    .setDescription('曜日フィルター')
                    .setRequired(false)
                    .addChoices(
                        { name: '平日のみ', value: 'weekdays' },
                        { name: '週末のみ', value: 'weekends' },
                        { name: 'すべて', value: 'all' },
                    ),
            ),
    )
    .addSubcommand((sub) =>
        sub.setName('list').setDescription('現在のイベント一覧を表示します'),
    )
    .addSubcommand((sub) =>
        sub.setName('manage').setDescription('イベントの詳細表示・編集・削除を行います'),
    );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
        case 'create':
            await handleCreate(interaction);
            break;
        case 'list':
            await handleList(interaction);
            break;
        case 'manage':
            await handleManage(interaction);
            break;
    }
}

/**
 * オートコンプリートハンドラ（残しておくが使わない場合もある）
 */
export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    const guildId = interaction.guildId;
    if (!guildId) return;

    const focused = interaction.options.getFocused();

    const events = await prisma.event.findMany({
        where: {
            guildId,
            status: { in: ['PLANNING', 'CONFIRMED'] },
            title: { contains: focused },
        },
        orderBy: { createdAt: 'desc' },
        take: 25,
    });

    await interaction.respond(
        events.map((e) => ({
            name: `${e.title}${e.date ? ` (${e.date})` : ''}`,
            value: e.id,
        })),
    );
}

/**
 * イベント作成 + 最適日抽出
 */
async function handleCreate(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();

    const guildId = interaction.guildId;
    if (!guildId) {
        await interaction.editReply({ embeds: [errorEmbed('エラー', 'サーバー内でのみ使用できます。')] });
        return;
    }

    const title = interaction.options.getString('title', true);
    const minParticipants = interaction.options.getInteger('min') ?? 1;
    const maxParticipants = interaction.options.getInteger('max') ?? undefined;

    // 必須メンバーの取得
    const requiredUserIds: string[] = [];
    for (const key of ['required1', 'required2', 'required3'] as const) {
        const user = interaction.options.getUser(key);
        if (user) requiredUserIds.push(user.id);
    }

    // 曜日フィルター
    const dayFilter = interaction.options.getString('dayfilter') ?? 'all';
    let dayOfWeekFilter: number[] | undefined;
    if (dayFilter === 'weekdays') dayOfWeekFilter = [1, 2, 3, 4, 5];
    else if (dayFilter === 'weekends') dayOfWeekFilter = [0, 6];

    // Guild がなければ自動作成
    await prisma.guild.upsert({
        where: { guildId },
        create: { guildId },
        update: {},
    });

    // User がなければ自動作成
    await prisma.user.upsert({
        where: { userId: interaction.user.id },
        create: { userId: interaction.user.id, discordTag: interaction.user.tag },
        update: { discordTag: interaction.user.tag },
    });

    // 翌月の期間を計算
    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const endOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 2, 0);
    const startDate = nextMonth.toISOString().split('T')[0];
    const endDate = endOfNextMonth.toISOString().split('T')[0];

    // 最適日抽出
    const candidates = await findOptimalDates({
        guildId,
        startDate,
        endDate,
        requiredUserIds,
        minParticipants,
        dayOfWeekFilter,
    });

    // イベントをDBに保存
    const event = await prisma.event.create({
        data: {
            guildId,
            title,
            minParticipants,
            maxParticipants: maxParticipants ?? null,
            createdBy: interaction.user.id,
        },
    });

    // 必須メンバーを保存
    for (const uid of requiredUserIds) {
        await prisma.user.upsert({
            where: { userId: uid },
            create: { userId: uid, discordTag: uid },
            update: {},
        });
        await prisma.eventRequirement.create({
            data: { eventId: event.id, requiredUserId: uid },
        });
    }

    if (candidates.length === 0) {
        await interaction.editReply({
            embeds: [
                infoEmbed(
                    'イベント作成完了',
                    `**${title}** を作成しましたが、現在の条件に合う候補日が見つかりません。\nメンバーに空き日の登録を依頼してください。\n\nイベントID: \`${event.id}\``,
                ),
            ],
        });
        return;
    }

    // 候補日のEmbed + セレクトメニュー
    const candidatesWithTags = candidates.map((c) => ({
        ...c,
        date: formatDateJP(c.date),
        members: c.members.map((uid) => `<@${uid}>`),
        tags: c.tags,
    }));

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`event_select_date:${event.id}`)
        .setPlaceholder('候補日を選択してください')
        .addOptions(
            candidates.map((c, i) => ({
                label: formatDateJP(c.date),
                description: [
                    `${c.count}人参加可能`,
                    ...(c.tags.slice(0, 1)),
                ].join(' | ').slice(0, 100),
                value: c.date,
                emoji: ['🥇', '🥈', '🥉'][i] ?? '📅',
            })),
        );

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

    await interaction.editReply({
        embeds: [candidateEmbed(candidatesWithTags)],
        components: [row],
    });
}

/**
 * イベント一覧
 */
async function handleList(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId;
    if (!guildId) {
        await interaction.reply({ embeds: [errorEmbed('エラー', 'サーバー内でのみ使用できます。')], ephemeral: true });
        return;
    }

    const events = await prisma.event.findMany({
        where: {
            guildId,
            status: { in: ['PLANNING', 'CONFIRMED'] },
        },
        include: {
            participants: { where: { status: 'CONFIRMED' } },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
    });

    if (events.length === 0) {
        await interaction.reply({
            embeds: [infoEmbed('イベント一覧', 'まだイベントがありません。\n`/event create` で作成しましょう！')],
            ephemeral: true,
        });
        return;
    }

    const descriptions = events.map((e) => {
        const statusEmoji = e.status === 'CONFIRMED' ? '✅' : '📝';
        const dateStr = e.date ? formatDateJP(e.date) : '未定';
        const count = e.participants.length;
        const maxStr = e.maxParticipants ? `/${e.maxParticipants}` : '';
        return `${statusEmoji} **${e.title}** | ${dateStr} | ${count}${maxStr}人`;
    });

    // 過去のイベントボタン
    const historyBtn = new ButtonBuilder()
        .setCustomId('event_history')
        .setLabel('📜 過去のイベント')
        .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(historyBtn);

    await interaction.reply({
        embeds: [infoEmbed('📋 イベント一覧', descriptions.join('\n') + '\n\n`/event manage` で管理できます')],
        components: [row],
        ephemeral: true,
    });
}

/**
 * イベント管理パネル
 * SelectMenuでイベントを選択 → 詳細表示 + アクションボタン
 */
async function handleManage(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId;
    if (!guildId) {
        await interaction.reply({ embeds: [errorEmbed('エラー', 'サーバー内でのみ使用できます。')], ephemeral: true });
        return;
    }

    const events = await prisma.event.findMany({
        where: {
            guildId,
            status: { in: ['PLANNING', 'CONFIRMED'] },
        },
        orderBy: { createdAt: 'desc' },
        take: 25,
    });

    if (events.length === 0) {
        await interaction.reply({
            embeds: [infoEmbed('イベント管理', 'まだイベントがありません。\n`/event create` で作成しましょう！')],
            ephemeral: true,
        });
        return;
    }

    // イベント選択メニュー
    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('event_manage_select')
        .setPlaceholder('管理するイベントを選択')
        .addOptions(
            events.map((e) => ({
                label: e.title,
                description: e.date ? formatDateJP(e.date) : '日程未定',
                value: e.id,
                emoji: e.status === 'CONFIRMED' ? '✅' : '📝',
            })),
        );

    // 複数削除ボタン
    const batchDeleteBtn = new ButtonBuilder()
        .setCustomId('event_batch_delete')
        .setLabel(`🗑️ まとめて削除（${events.length}件）`)
        .setStyle(ButtonStyle.Danger);

    // 再提案ボタン
    const recomendBtn = new ButtonBuilder()
        .setCustomId('event_recommend')
        .setLabel('🔍 最適日を再提案')
        .setStyle(ButtonStyle.Primary);

    const row1 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);
    const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(recomendBtn, batchDeleteBtn);

    await interaction.reply({
        embeds: [infoEmbed(
            '⚙️ イベント管理',
            '管理したいイベントを選択してください。\n\n' +
            '**選択後にできること:**\n' +
            '📋 詳細表示 / ✏️ 編集 / 🗑️ 削除',
        )],
        components: [row1, row2],
        ephemeral: true,
    });
}
