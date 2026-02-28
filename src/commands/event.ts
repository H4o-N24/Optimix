/**
 * /event コマンド - イベント作成・管理 (i18n対応)
 *
 * サブコマンド:
 * - /event create: 条件付きイベント作成 + 最適日抽出
 * - /event list:   イベント一覧表示
 * - /event manage: イベント管理パネル
 */

import {
    SlashCommandBuilder,
    type ChatInputCommandInteraction,
    type AutocompleteInteraction,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle, MessageFlags } from 'discord.js';
import { findOptimalDates } from '../services/scheduler.js';
import { candidateEmbed, infoEmbed, errorEmbed } from '../utils/embeds.js';
import { formatDateJP } from '../utils/date.js';
import { prisma } from '../lib/prisma.js';
import { ensureGuildAndUser, ensureUser } from '../lib/upsertHelpers.js';
import { canCreateEvent, incrementEventCount } from '../lib/guildPlan.js';
import { getT } from '../i18n/index.js';

export const data = new SlashCommandBuilder()
    .setName('event')
    .setDescription('イベントを管理 / Manage events')
    .addSubcommand((sub) =>
        sub
            .setName('create')
            .setDescription('新しいイベントを作成 / Create a new event')
            .addStringOption((opt) => opt.setName('title').setDescription('イベント名 / Event title').setRequired(true))
            .addIntegerOption((opt) => opt.setName('min').setDescription('最低参加人数 / Min participants').setRequired(false))
            .addIntegerOption((opt) => opt.setName('max').setDescription('定員 / Max capacity').setRequired(false))
            .addUserOption((opt) => opt.setName('required1').setDescription('必須メンバー1 / Required member 1').setRequired(false))
            .addUserOption((opt) => opt.setName('required2').setDescription('必須メンバー2 / Required member 2').setRequired(false))
            .addUserOption((opt) => opt.setName('required3').setDescription('必須メンバー3 / Required member 3').setRequired(false))
            .addStringOption((opt) =>
                opt
                    .setName('dayfilter')
                    .setDescription('曜日フィルター / Day filter')
                    .setRequired(false)
                    .addChoices(
                        { name: '平日のみ / Weekdays only', value: 'weekdays' },
                        { name: '週末のみ / Weekends only', value: 'weekends' },
                        { name: 'すべて / All', value: 'all' },
                    ),
            ),
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('イベント一覧 / Event list'))
    .addSubcommand((sub) => sub.setName('manage').setDescription('イベント管理パネル / Event management panel'));

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const subcommand = interaction.options.getSubcommand();
    switch (subcommand) {
        case 'create': await handleCreate(interaction); break;
        case 'list': await handleList(interaction); break;
        case 'manage': await handleManage(interaction); break;
    }
}

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    const guildId = interaction.guildId;
    if (!guildId) return;
    const focused = interaction.options.getFocused();
    const events = await prisma.event.findMany({
        where: { guildId, status: { in: ['PLANNING', 'CONFIRMED'] }, title: { contains: focused } },
        orderBy: { createdAt: 'desc' },
        take: 25,
    });
    await interaction.respond(events.map((e) => ({ name: `${e.title}${e.date ? ` (${e.date})` : ''}`, value: e.id })));
}

// ─────────────────────────────────────────────
// /event create
// ─────────────────────────────────────────────
async function handleCreate(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();

    const guildId = interaction.guildId;
    const t = await getT(guildId);

    if (!guildId) {
        await interaction.editReply({ embeds: [errorEmbed(t.common.errorTitle, t.common.guildOnly)] });
        return;
    }

    const title = interaction.options.getString('title', true);
    const minParticipants = interaction.options.getInteger('min') ?? 1;
    const maxParticipants = interaction.options.getInteger('max') ?? undefined;

    const requiredUserIds: string[] = [];
    for (const key of ['required1', 'required2', 'required3'] as const) {
        const user = interaction.options.getUser(key);
        if (user) requiredUserIds.push(user.id);
    }

    const dayFilter = interaction.options.getString('dayfilter') ?? 'all';
    let dayOfWeekFilter: number[] | undefined;
    if (dayFilter === 'weekdays') dayOfWeekFilter = [1, 2, 3, 4, 5];
    else if (dayFilter === 'weekends') dayOfWeekFilter = [0, 6];

    await ensureGuildAndUser(guildId, interaction.user.id, interaction.user.tag);

    // ─── プレミアム制限チェック ───
    const { allowed } = await canCreateEvent(guildId);
    if (!allowed) {
        await interaction.editReply({ embeds: [errorEmbed(t.premium.limitTitle, t.premium.limitDesc)] });
        return;
    }
    // ─── 制限チェックここまで ───

    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const endOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 2, 0);
    const startDate = nextMonth.toISOString().split('T')[0];
    const endDate = endOfNextMonth.toISOString().split('T')[0];

    const candidates = await findOptimalDates({ guildId, startDate, endDate, requiredUserIds, minParticipants, dayOfWeekFilter });

    const event = await prisma.event.create({
        data: {
            guildId,
            title,
            minParticipants,
            maxParticipants: maxParticipants ?? null,
            createdBy: interaction.user.id,
        },
    });

    for (const uid of requiredUserIds) {
        await ensureUser(uid, uid);
        await prisma.eventRequirement.create({ data: { eventId: event.id, requiredUserId: uid } });
    }

    if (candidates.length === 0) {
        await interaction.editReply({ embeds: [infoEmbed(t.event.noCandidatesTitle, t.event.noCandidatesDesc(title, event.id))] });
        return;
    }

    const candidatesWithTags = candidates.map((c) => ({
        ...c,
        date: formatDateJP(c.date),
        members: c.members.map((uid) => `<@${uid}>`),
        tags: c.tags,
    }));

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`event_select_date:${event.id}`)
        .setPlaceholder(t.event.selectPlaceholder)
        .addOptions(
            candidates.map((c, i) => ({
                label: formatDateJP(c.date),
                description: `${t.event.participantsLabel(c.count)} | ${c.tags[0] ?? ''}`.slice(0, 100),
                value: c.date,
                emoji: ['🥇', '🥈', '🥉'][i] ?? '📅',
            })),
        );

    await interaction.editReply({
        embeds: [candidateEmbed(candidatesWithTags)],
        components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu)],
    });
}

// ─────────────────────────────────────────────
// /event list
// ─────────────────────────────────────────────
async function handleList(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId;
    const t = await getT(guildId);

    if (!guildId) {
        await interaction.reply({ embeds: [errorEmbed(t.common.errorTitle, t.common.guildOnly)], flags: MessageFlags.Ephemeral });
        return;
    }

    const events = await prisma.event.findMany({
        where: { guildId, status: { in: ['PLANNING', 'CONFIRMED'] } },
        include: { participants: { where: { status: 'CONFIRMED' } } },
        orderBy: { createdAt: 'desc' },
        take: 10,
    });

    if (events.length === 0) {
        await interaction.reply({ embeds: [infoEmbed(t.event.listTitle, t.event.listEmpty)], flags: MessageFlags.Ephemeral });
        return;
    }

    const descriptions = events.map((e) => {
        const statusEmoji = e.status === 'CONFIRMED' ? '✅' : '📝';
        const dateStr = e.date ? formatDateJP(e.date) : t.event.dateTbd;
        const maxStr = e.maxParticipants ? `/${e.maxParticipants}` : '';
        return `${statusEmoji} **${e.title}** | ${dateStr} | ${e.participants.length}${maxStr}人`;
    });

    const historyBtn = new ButtonBuilder()
        .setCustomId('event_history')
        .setLabel(t.event.historyBtn)
        .setStyle(ButtonStyle.Secondary);

    await interaction.reply({
        embeds: [infoEmbed(t.event.listTitle, descriptions.join('\n') + `\n\n${t.event.listHint}`)],
        components: [new ActionRowBuilder<ButtonBuilder>().addComponents(historyBtn)],
        flags: MessageFlags.Ephemeral,
    });
}

// ─────────────────────────────────────────────
// /event manage
// ─────────────────────────────────────────────
async function handleManage(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId;
    const t = await getT(guildId);

    if (!guildId) {
        await interaction.reply({ embeds: [errorEmbed(t.common.errorTitle, t.common.guildOnly)], flags: MessageFlags.Ephemeral });
        return;
    }

    const events = await prisma.event.findMany({
        where: { guildId, status: { in: ['PLANNING', 'CONFIRMED'] } },
        orderBy: { createdAt: 'desc' },
        take: 25,
    });

    if (events.length === 0) {
        await interaction.reply({ embeds: [infoEmbed(t.event.manageTitle, t.event.manageEmpty)], flags: MessageFlags.Ephemeral });
        return;
    }

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('event_manage_select')
        .setPlaceholder(t.event.managePlaceholder)
        .addOptions(
            events.map((e) => ({
                label: e.title,
                description: e.date ? formatDateJP(e.date) : t.event.dateUnset,
                value: e.id,
                emoji: e.status === 'CONFIRMED' ? '✅' : '📝',
            })),
        );

    const batchDeleteBtn = new ButtonBuilder()
        .setCustomId('event_batch_delete')
        .setLabel(t.event.batchDeleteBtn(events.length))
        .setStyle(ButtonStyle.Danger);

    const recommendBtn = new ButtonBuilder()
        .setCustomId('event_recommend')
        .setLabel(t.event.recommendBtn)
        .setStyle(ButtonStyle.Primary);

    await interaction.reply({
        embeds: [infoEmbed(t.event.manageTitle, t.event.manageHint)],
        components: [
            new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu),
            new ActionRowBuilder<ButtonBuilder>().addComponents(recommendBtn, batchDeleteBtn),
        ],
        flags: MessageFlags.Ephemeral,
    });
}
