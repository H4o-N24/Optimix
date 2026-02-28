/**
 * handlers/event.ts
 *
 * イベント確定・履歴・再提案処理
 */

import {
    type ButtonInteraction,
    type StringSelectMenuInteraction,
    ActionRowBuilder,
    StringSelectMenuBuilder, MessageFlags } from 'discord.js';
import { prisma } from '../../lib/prisma.js';
import { successEmbed, errorEmbed, infoEmbed, confirmedEventEmbed } from '../../utils/embeds.js';
import { formatDateJP } from '../../utils/date.js';
import { joinEvent, cancelEvent } from '../../services/participant.js';
import { ensureUser } from '../../lib/upsertHelpers.js';
import { getT } from '../../i18n/index.js';

// ─────────────────────────────────────────────
// イベント: 候補日確定 (SelectMenu → 参加ボタン付き確定Embed)
// ─────────────────────────────────────────────
export async function handleEventSelectDate(
    interaction: StringSelectMenuInteraction,
    eventId: string,
): Promise<void> {
    await interaction.deferUpdate();
    const t = await getT(interaction.guildId);
    const selectedDate = interaction.values[0];

    const event = await prisma.event.update({
        where: { id: eventId },
        data: { date: selectedDate, status: 'CONFIRMED' },
        include: { participants: true },
    });

    const confirmedCount = event.participants.filter((p) => p.status === 'CONFIRMED').length;
    const waitlistedCount = event.participants.filter((p) => p.status === 'WAITLISTED').length;

    await interaction.editReply({
        embeds: [
            confirmedEventEmbed({
                title: event.title,
                date: formatDateJP(selectedDate),
                confirmedCount,
                maxParticipants: event.maxParticipants,
                waitlistedCount,
                eventId: event.id,
            }),
        ],
        components: [
            {
                type: 1,
                components: [
                    { type: 2, custom_id: `event_join:${event.id}`, label: t.event.joinBtn, style: 3, emoji: { name: '✅' } },
                    { type: 2, custom_id: `event_cancel:${event.id}`, label: t.event.cancelBtn, style: 4, emoji: { name: '❌' } },
                ],
            },
        ],
    });
}

// ─────────────────────────────────────────────
// イベント: 参加ボタン
// ─────────────────────────────────────────────
export async function handleEventJoin(
    interaction: ButtonInteraction,
    eventId: string,
): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const t = await getT(interaction.guildId);
    await ensureUser(interaction.user.id, interaction.user.tag);
    const result = await joinEvent(eventId, interaction.user.id);
    const embed = result.success
        ? (await import('../../utils/embeds.js')).successEmbed(t.participant.joinTitle, result.message)
        : infoEmbed(t.participant.joinTitle, result.message);
    await interaction.editReply({ embeds: [embed] });
}

// ─────────────────────────────────────────────
// イベント: キャンセルボタン
// ─────────────────────────────────────────────
export async function handleEventCancel(
    interaction: ButtonInteraction,
    eventId: string,
): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const t = await getT(interaction.guildId);
    await ensureUser(interaction.user.id, interaction.user.tag);
    const result = await cancelEvent(eventId, interaction.user.id);
    const embed = result.success
        ? (await import('../../utils/embeds.js')).successEmbed(t.participant.cancelTitle, result.message)
        : errorEmbed(t.participant.cancelTitle, result.message);
    await interaction.editReply({ embeds: [embed] });

    if (result.promotedUserId) {
        await interaction.followUp({ content: t.participant.promotedMsg(result.promotedUserId) });
    }
}

// ─────────────────────────────────────────────
// イベント: 過去のイベント（アーカイブ）表示
// ─────────────────────────────────────────────
export async function showEventHistory(interaction: ButtonInteraction): Promise<void> {
    const guildId = interaction.guildId;
    if (!guildId) return;
    const t = await getT(guildId);

    const archivedEvents = await prisma.event.findMany({
        where: { guildId, status: 'ARCHIVED' },
        include: { participants: { where: { status: 'CONFIRMED' } } },
        orderBy: { date: 'desc' },
        take: 20,
    });

    if (archivedEvents.length === 0) {
        await interaction.reply({ embeds: [infoEmbed(t.event.historyTitle, t.event.historyEmpty)], flags: MessageFlags.Ephemeral });
        return;
    }

    const descriptions = archivedEvents.map((e) => {
        const dateStr = e.date ? formatDateJP(e.date) : t.event.dateNone;
        return `📦 **${e.title}** | ${dateStr} | ${t.event.historyParticipants(e.participants.length)}`;
    });

    await interaction.reply({
        embeds: [infoEmbed(t.event.historyTitle, descriptions.join('\n'))],
        flags: MessageFlags.Ephemeral,
    });
}

// ─────────────────────────────────────────────
// イベント: 最適日再提案メニュー表示
// ─────────────────────────────────────────────
export async function handleEventRecommend(interaction: ButtonInteraction): Promise<void> {
    const guildId = interaction.guildId;
    if (!guildId) return;
    const t = await getT(guildId);

    const events = await prisma.event.findMany({
        where: { guildId, status: { in: ['PLANNING', 'CONFIRMED'] } },
        include: { requirements: true },
        orderBy: { createdAt: 'desc' },
        take: 25,
    });

    if (events.length === 0) {
        await interaction.reply({ embeds: [infoEmbed(t.event.recommendTitle, t.event.recommendEmpty)], flags: MessageFlags.Ephemeral });
        return;
    }

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('event_recommend_select')
        .setPlaceholder(t.event.recommendPlaceholder)
        .addOptions(
            events.map((e) => ({
                label: e.title,
                description: e.date ? t.event.currentDate(formatDateJP(e.date)) : t.event.dateUnset,
                value: e.id,
                emoji: e.status === 'CONFIRMED' ? '✅' : '📝',
            })),
        );

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

    await interaction.reply({
        embeds: [infoEmbed(t.event.recommendTitle, t.event.recommendDesc)],
        components: [row],
        flags: MessageFlags.Ephemeral,
    });
}
