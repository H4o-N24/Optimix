/**
 * /event コマンド - イベント作成・管理
 *
 * サブコマンド:
 * - /event create: 条件付きイベント作成 + 最適日抽出
 * - /event list: イベント一覧表示
 * - /event info: イベント詳細表示
 */

import {
    SlashCommandBuilder,
    type ChatInputCommandInteraction,
    type AutocompleteInteraction,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    type StringSelectMenuOptionBuilder,
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
        sub
            .setName('info')
            .setDescription('イベントの詳細を表示します')
            .addStringOption((opt) =>
                opt.setName('id').setDescription('イベント名で検索').setRequired(true).setAutocomplete(true),
            ),
    )
    .addSubcommand((sub) =>
        sub
            .setName('edit')
            .setDescription('イベントを編集します')
            .addStringOption((opt) =>
                opt.setName('id').setDescription('イベント名で検索').setRequired(true).setAutocomplete(true),
            )
            .addStringOption((opt) =>
                opt.setName('title').setDescription('新しいイベント名').setRequired(false),
            )
            .addIntegerOption((opt) =>
                opt.setName('min').setDescription('新しい最低参加人数').setRequired(false),
            )
            .addIntegerOption((opt) =>
                opt.setName('max').setDescription('新しい定員').setRequired(false),
            ),
    )
    .addSubcommand((sub) =>
        sub
            .setName('delete')
            .setDescription('イベントを選択して削除します（複数選択可）'),
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
        case 'info':
            await handleInfo(interaction);
            break;
        case 'edit':
            await handleEdit(interaction);
            break;
        case 'delete':
            await handleDelete(interaction);
            break;
    }
}

/**
 * オートコンプリートハンドラ: イベント名で検索
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
    }));

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`event_select_date:${event.id}`)
        .setPlaceholder('候補日を選択してください')
        .addOptions(
            candidates.map((c, i) => ({
                label: formatDateJP(c.date),
                description: `${c.count}人参加可能`,
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
        return `${statusEmoji} **${e.title}** | ${dateStr} | ${count}${maxStr}人 | ID: \`${e.id}\``;
    });

    await interaction.reply({
        embeds: [infoEmbed('📋 イベント一覧', descriptions.join('\n'))],
        ephemeral: true,
    });
}

/**
 * イベント詳細
 */
async function handleInfo(interaction: ChatInputCommandInteraction): Promise<void> {
    const eventId = interaction.options.getString('id', true);

    const event = await prisma.event.findUnique({
        where: { id: eventId },
        include: {
            participants: { include: { user: true }, orderBy: { joinedAt: 'asc' } },
            requirements: { include: { user: true } },
        },
    });

    if (!event) {
        await interaction.reply({
            embeds: [errorEmbed('エラー', 'イベントが見つかりません。')],
            ephemeral: true,
        });
        return;
    }

    const confirmed = event.participants.filter((p) => p.status === 'CONFIRMED');
    const waitlisted = event.participants.filter((p) => p.status === 'WAITLISTED');
    const required = event.requirements.map((r) => `<@${r.requiredUserId}>`);

    const fields = [
        { name: 'ステータス', value: event.status, inline: true },
        { name: '日程', value: event.date ? formatDateJP(event.date) : '未定', inline: true },
        { name: '最低人数', value: `${event.minParticipants}人`, inline: true },
        {
            name: `参加確定（${confirmed.length}${event.maxParticipants ? `/${event.maxParticipants}` : ''}人）`,
            value: confirmed.length > 0 ? confirmed.map((p) => `<@${p.userId}>`).join(', ') : 'なし',
            inline: false,
        },
    ];

    if (waitlisted.length > 0) {
        fields.push({
            name: `キャンセル待ち（${waitlisted.length}人）`,
            value: waitlisted.map((p) => `<@${p.userId}>`).join(', '),
            inline: false,
        });
    }

    if (required.length > 0) {
        fields.push({
            name: '必須メンバー',
            value: required.join(', '),
            inline: false,
        });
    }

    // 参加/キャンセルボタン
    const joinBtn = new ButtonBuilder()
        .setCustomId(`event_join:${event.id}`)
        .setLabel('参加')
        .setStyle(ButtonStyle.Success)
        .setEmoji('✅');

    const cancelBtn = new ButtonBuilder()
        .setCustomId(`event_cancel:${event.id}`)
        .setLabel('キャンセル')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('❌');

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(joinBtn, cancelBtn);

    const embed = infoEmbed(event.title, event.description ?? 'イベントの詳細');
    embed.setFields(fields);

    await interaction.reply({
        embeds: [embed],
        components: [row],
    });
}

/**
 * イベント編集
 */
async function handleEdit(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const eventId = interaction.options.getString('id', true);
    const event = await prisma.event.findUnique({ where: { id: eventId } });

    if (!event) {
        await interaction.editReply({ embeds: [errorEmbed('エラー', 'イベントが見つかりません。')] });
        return;
    }

    if (event.createdBy !== interaction.user.id) {
        await interaction.editReply({ embeds: [errorEmbed('権限エラー', 'イベントの編集は作成者のみ可能です。')] });
        return;
    }

    const newTitle = interaction.options.getString('title');
    const newMin = interaction.options.getInteger('min');
    const newMax = interaction.options.getInteger('max');

    if (!newTitle && newMin === null && newMax === null) {
        await interaction.editReply({ embeds: [errorEmbed('入力エラー', '変更する項目を少なくとも1つ指定してください。\n`title`, `min`, `max` のいずれか')] });
        return;
    }

    const updateData: { title?: string; minParticipants?: number; maxParticipants?: number | null } = {};
    const changes: string[] = [];

    if (newTitle) {
        updateData.title = newTitle;
        changes.push(`📝 イベント名: **${event.title}** → **${newTitle}**`);
    }
    if (newMin !== null) {
        updateData.minParticipants = newMin;
        changes.push(`👥 最低人数: **${event.minParticipants}** → **${newMin}**`);
    }
    if (newMax !== null) {
        updateData.maxParticipants = newMax === 0 ? null : newMax;
        changes.push(`📊 定員: **${event.maxParticipants ?? '無制限'}** → **${newMax === 0 ? '無制限' : newMax}**`);
    }

    await prisma.event.update({ where: { id: eventId }, data: updateData });

    await interaction.editReply({
        embeds: [successEmbed('イベントを更新しました', changes.join('\n'))],
    });
}

/**
 * イベント削除（SelectMenuで複数選択）
 */
async function handleDelete(interaction: ChatInputCommandInteraction): Promise<void> {
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
            embeds: [infoEmbed('削除対象なし', '削除できるイベントがありません。')],
            ephemeral: true,
        });
        return;
    }

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('event_delete_select')
        .setPlaceholder('削除するイベントを選択（複数選択可）')
        .setMinValues(1)
        .setMaxValues(events.length)
        .addOptions(
            events.map((e) => ({
                label: e.title,
                description: e.date ? formatDateJP(e.date) : '日程未定',
                value: e.id,
                emoji: e.status === 'CONFIRMED' ? '✅' : '📝',
            })),
        );

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

    await interaction.reply({
        embeds: [infoEmbed('🗑️ イベント削除', '削除するイベントを選択してください。\n複数選択できます。')],
        components: [row],
        ephemeral: true,
    });
}
