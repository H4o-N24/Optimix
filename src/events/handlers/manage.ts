/**
 * handlers/manage.ts
 *
 * イベント管理パネル・編集・削除処理
 */

import {
    type ButtonInteraction,
    type StringSelectMenuInteraction,
    type ModalSubmitInteraction,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle, MessageFlags } from 'discord.js';
import { prisma } from '../../lib/prisma.js';
import { successEmbed, errorEmbed, infoEmbed } from '../../utils/embeds.js';
import { formatDateJP } from '../../utils/date.js';
import { getT } from '../../i18n/index.js';

// ─────────────────────────────────────────────
// イベント管理パネル（SelectMenu選択後）
// ─────────────────────────────────────────────
export async function showEventManagePanel(
    interaction: StringSelectMenuInteraction,
    eventId: string,
): Promise<void> {
    const t = await getT(interaction.guildId);
    const event = await prisma.event.findUnique({
        where: { id: eventId },
        include: {
            participants: { include: { user: true }, orderBy: { joinedAt: 'asc' } },
            requirements: true,
        },
    });

    if (!event) {
        await interaction.reply({ embeds: [errorEmbed(t.common.errorTitle, t.common.notFound)], flags: MessageFlags.Ephemeral });
        return;
    }

    const confirmed = event.participants.filter((p) => p.status === 'CONFIRMED');
    const waitlisted = event.participants.filter((p) => p.status === 'WAITLISTED');
    const required = event.requirements.map((r) => `<@${r.requiredUserId}>`);

    const statusEmoji = event.status === 'CONFIRMED' ? t.event.statusConfirmed : t.event.statusPlanning;
    const dateStr = event.date ? formatDateJP(event.date) : t.event.dateTbd;
    const maxStr = event.maxParticipants ? `/${event.maxParticipants}` : '';

    const description: string[] = [
        `**ステータス:** ${statusEmoji}`,
        `${t.event.dateLabel} ${dateStr}`,
        `${t.event.minLabel} ${event.minParticipants}`,
        `${t.event.confirmedLabel} ${confirmed.length}${maxStr}`,
    ];

    if (confirmed.length > 0) description.push(`> ${confirmed.map((p) => `<@${p.userId}>`).join(', ')}`);
    if (waitlisted.length > 0) {
        description.push(`${t.event.waitlistLabel} ${waitlisted.length}`);
        description.push(`> ${waitlisted.map((p) => `<@${p.userId}>`).join(', ')}`);
    }
    if (required.length > 0) description.push(`${t.event.requiredLabel} ${required.join(', ')}`);

    const infoBtn = new ButtonBuilder().setCustomId(`event_manage_info:${event.id}`).setLabel(t.event.infoBtn).setStyle(ButtonStyle.Success);
    const editBtn = new ButtonBuilder().setCustomId(`event_manage_edit:${event.id}`).setLabel(t.event.editBtn).setStyle(ButtonStyle.Primary);
    const deleteBtn = new ButtonBuilder().setCustomId(`event_manage_delete:${event.id}`).setLabel(t.event.deleteBtn).setStyle(ButtonStyle.Danger);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(infoBtn, editBtn, deleteBtn);

    await interaction.reply({
        embeds: [infoEmbed(`⚙️ ${event.title}`, description.join('\n'))],
        components: [row],
        flags: MessageFlags.Ephemeral,
    });
}

// ─────────────────────────────────────────────
// イベント詳細表示（参加ボタン付き・全員公開）
// ─────────────────────────────────────────────
export async function showEventDetail(
    interaction: ButtonInteraction,
    eventId: string,
): Promise<void> {
    const t = await getT(interaction.guildId);
    const event = await prisma.event.findUnique({
        where: { id: eventId },
        include: {
            participants: { include: { user: true }, orderBy: { joinedAt: 'asc' } },
        },
    });

    if (!event) {
        await interaction.reply({ embeds: [errorEmbed(t.common.errorTitle, t.common.notFound)], flags: MessageFlags.Ephemeral });
        return;
    }

    const confirmed = event.participants.filter((p) => p.status === 'CONFIRMED');
    const waitlisted = event.participants.filter((p) => p.status === 'WAITLISTED');
    const maxStr = event.maxParticipants ? `/${event.maxParticipants}` : '';
    const dateStr = event.date ? formatDateJP(event.date) : t.event.dateTbd;

    const fields = [
        `${t.event.scheduleLabel} ${dateStr}`,
        `${t.event.participantsDetailLabel} ${confirmed.length}${maxStr}`,
    ];
    if (confirmed.length > 0) fields.push(`> ${confirmed.map((p) => `<@${p.userId}>`).join(', ')}`);
    if (waitlisted.length > 0) fields.push(`${t.event.waitlistDetailLabel} ${waitlisted.map((p) => `<@${p.userId}>`).join(', ')}`);

    const joinBtn = new ButtonBuilder().setCustomId(`event_join:${event.id}`).setLabel(t.event.joinBtn).setStyle(ButtonStyle.Success).setEmoji('✅');
    const cancelBtn = new ButtonBuilder().setCustomId(`event_cancel:${event.id}`).setLabel(t.event.cancelBtn).setStyle(ButtonStyle.Danger).setEmoji('❌');
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(joinBtn, cancelBtn);

    await interaction.reply({
        embeds: [infoEmbed(`📌 ${event.title}`, fields.join('\n'))],
        components: [row],
    });
}

// ─────────────────────────────────────────────
// 編集 Modal 表示
// ─────────────────────────────────────────────
export async function showEditModal(
    interaction: ButtonInteraction,
    eventId: string,
): Promise<void> {
    const t = await getT(interaction.guildId);
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) {
        await interaction.reply({ embeds: [errorEmbed(t.common.errorTitle, t.common.notFound)], flags: MessageFlags.Ephemeral });
        return;
    }

    const modal = new ModalBuilder().setCustomId(`event_edit_modal:${eventId}`).setTitle(t.event.editModalTitle);

    modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder().setCustomId('edit_title').setLabel(t.event.editTitleLabel).setStyle(TextInputStyle.Short).setValue(event.title).setRequired(true),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder().setCustomId('edit_min').setLabel(t.event.editMinLabel).setStyle(TextInputStyle.Short).setValue(String(event.minParticipants)).setRequired(false),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder().setCustomId('edit_max').setLabel(t.event.editMaxLabel).setStyle(TextInputStyle.Short).setValue(String(event.maxParticipants ?? 0)).setRequired(false),
        ),
    );

    await interaction.showModal(modal);
}

// ─────────────────────────────────────────────
// 編集 Modal 送信
// ─────────────────────────────────────────────
export async function handleEditSubmit(interaction: ModalSubmitInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const t = await getT(interaction.guildId);

    const eventId = interaction.customId.split(':')[1];
    const event = await prisma.event.findUnique({ where: { id: eventId } });

    if (!event) {
        await interaction.editReply({ embeds: [errorEmbed(t.common.errorTitle, t.common.notFound)] });
        return;
    }

    const newTitle = interaction.fields.getTextInputValue('edit_title');
    const newMinStr = interaction.fields.getTextInputValue('edit_min');
    const newMaxStr = interaction.fields.getTextInputValue('edit_max');

    const updateData: { title?: string; minParticipants?: number; maxParticipants?: number | null } = {};
    const changes: string[] = [];

    if (newTitle && newTitle !== event.title) {
        updateData.title = newTitle;
        changes.push(t.event.editTitleChanged(event.title, newTitle));
    }

    const newMin = parseInt(newMinStr);
    if (!isNaN(newMin) && newMin !== event.minParticipants) {
        updateData.minParticipants = newMin;
        changes.push(t.event.editMinChanged(event.minParticipants, newMin));
    }

    const newMax = parseInt(newMaxStr);
    if (!isNaN(newMax)) {
        const maxValue = newMax === 0 ? null : newMax;
        if (maxValue !== event.maxParticipants) {
            updateData.maxParticipants = maxValue;
            changes.push(t.event.editMaxChanged(event.maxParticipants ?? t.event.unlimited, maxValue ?? t.event.unlimited));
        }
    }

    if (changes.length === 0) {
        await interaction.editReply({ embeds: [infoEmbed(t.common.noChange, t.common.noChange)] });
        return;
    }

    await prisma.event.update({ where: { id: eventId }, data: updateData });
    await interaction.editReply({ embeds: [successEmbed(t.event.editedTitle, changes.join('\n'))] });
}

// ─────────────────────────────────────────────
// 単一削除
// ─────────────────────────────────────────────
export async function handleSingleDelete(
    interaction: ButtonInteraction,
    eventId: string,
): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const t = await getT(interaction.guildId);
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) {
        await interaction.editReply({ embeds: [errorEmbed(t.common.errorTitle, t.common.notFound)] });
        return;
    }
    await prisma.event.delete({ where: { id: eventId } });
    await interaction.editReply({ embeds: [successEmbed(t.event.deletedTitle, t.event.deletedDesc(event.title))] });
}

// ─────────────────────────────────────────────
// まとめて削除: SelectMenu 表示
// ─────────────────────────────────────────────
export async function showBatchDeleteMenu(interaction: ButtonInteraction): Promise<void> {
    const guildId = interaction.guildId;
    if (!guildId) return;
    const t = await getT(guildId);

    const events = await prisma.event.findMany({
        where: { guildId, status: { in: ['PLANNING', 'CONFIRMED'] } },
        orderBy: { createdAt: 'desc' },
        take: 25,
    });

    if (events.length === 0) {
        await interaction.reply({ embeds: [infoEmbed(t.event.noDeleteTargetTitle, t.event.noDeleteTarget)], flags: MessageFlags.Ephemeral });
        return;
    }

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('event_delete_select')
        .setPlaceholder(t.event.batchDeletePlaceholder)
        .setMinValues(1)
        .setMaxValues(events.length)
        .addOptions(
            events.map((e) => ({
                label: e.title,
                description: e.date ? formatDateJP(e.date) : t.event.dateUnset,
                value: e.id,
                emoji: e.status === 'CONFIRMED' ? '✅' : '📝',
            })),
        );

    await interaction.reply({
        embeds: [infoEmbed(t.event.batchDeleteMenuTitle, t.event.batchDeleteMenuDesc)],
        components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu)],
        flags: MessageFlags.Ephemeral,
    });
}

// ─────────────────────────────────────────────
// まとめて削除: 実行
// ─────────────────────────────────────────────
export async function handleBatchDeleteConfirm(
    interaction: StringSelectMenuInteraction,
): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const t = await getT(interaction.guildId);
    const selectedIds = interaction.values;
    const events = await prisma.event.findMany({ where: { id: { in: selectedIds } } });

    if (events.length === 0) {
        await interaction.editReply({ embeds: [errorEmbed(t.common.errorTitle, t.common.notFound)] });
        return;
    }

    await prisma.event.deleteMany({ where: { id: { in: selectedIds } } });
    const deletedNames = events.map((e) => `• **${e.title}**`).join('\n');
    await interaction.editReply({ embeds: [successEmbed(t.event.batchDeleteTitle(events.length), deletedNames)] });
}
