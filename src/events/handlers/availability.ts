/**
 * handlers/availability.ts
 *
 * 空き日関連のボタン・SelectMenu処理
 */

import {
    type ButtonInteraction,
    type StringSelectMenuInteraction, MessageFlags } from 'discord.js';
import { prisma } from '../../lib/prisma.js';
import { ensureGuildAndUser } from '../../lib/upsertHelpers.js';
import { successEmbed, errorEmbed, infoEmbed } from '../../utils/embeds.js';
import { formatDateJP, getNextMonthInfo } from '../../utils/date.js';
import { getT } from '../../i18n/index.js';

/** ユーザーごとの空き日選択状態を一時保持 */
export const availabilitySelections = new Map<string, Set<string>>();

// ─────────────────────────────────────────────
// 空き日 SelectMenu 選択 (前半 / 後半)
// ─────────────────────────────────────────────
export async function handleAvailabilitySelect(
    interaction: StringSelectMenuInteraction,
): Promise<void> {
    const key = `${interaction.user.id}:${interaction.guildId}`;
    const isFirst = interaction.customId === 'availability_select_first';
    const t = await getT(interaction.guildId);

    let selections = availabilitySelections.get(key);
    if (!selections) {
        selections = new Set();
        availabilitySelections.set(key, selections);
    }

    const { year, month } = getNextMonthInfo();
    const monthStr = String(month).padStart(2, '0');

    // 対応する半を一旦クリア
    const rangeEnd = isFirst ? 15 : 31;
    const rangeStart = isFirst ? 1 : 16;
    for (let d = rangeStart; d <= rangeEnd; d++) {
        selections.delete(`${year}-${monthStr}-${String(d).padStart(2, '0')}`);
    }

    for (const val of interaction.values) selections.add(val);

    const sorted = Array.from(selections).sort();
    const dateList = sorted.map(formatDateJP).join('\n') || t.availability.noneSelected;

    await interaction.reply({
        embeds: [
            infoEmbed(
                t.availability.selectionTitle(sorted.length),
                `${dateList}\n\n${t.availability.selectionHint}`,
            ),
        ],
        flags: MessageFlags.Ephemeral,
    });
}

// ─────────────────────────────────────────────
// 空き日 確定ボタン
// ─────────────────────────────────────────────
export async function handleAvailabilityConfirm(
    interaction: ButtonInteraction,
): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const guildId = interaction.guildId;
    const t = await getT(guildId);

    if (!guildId) {
        await interaction.editReply({ embeds: [errorEmbed(t.common.errorTitle, t.common.guildOnly)] });
        return;
    }

    const key = `${interaction.user.id}:${guildId}`;
    const selections = availabilitySelections.get(key);

    if (!selections || selections.size === 0) {
        await interaction.editReply({
            embeds: [errorEmbed(t.availability.notSelectedTitle, t.availability.notSelectedError)],
        });
        return;
    }

    await ensureGuildAndUser(guildId, interaction.user.id, interaction.user.tag);

    const dateStrings = Array.from(selections).sort();
    const { year, month } = getNextMonthInfo();
    const monthStr = String(month).padStart(2, '0');

    await prisma.availability.deleteMany({
        where: { userId: interaction.user.id, guildId, date: { startsWith: `${year}-${monthStr}` } },
    });
    await prisma.availability.createMany({
        data: dateStrings.map((date) => ({ userId: interaction.user.id, guildId, date, status: 'AVAILABLE' })),
    });

    availabilitySelections.delete(key);

    const formattedDates = dateStrings.map(formatDateJP).join('\n');
    await interaction.editReply({
        embeds: [successEmbed(t.availability.savedTitle, `${t.availability.savedDesc(dateStrings.length)}\n\n${formattedDates}`)],
    });
}

// ─────────────────────────────────────────────
// 空き日 クリアボタン
// ─────────────────────────────────────────────
export async function handleAvailabilityClear(
    interaction: ButtonInteraction,
): Promise<void> {
    const key = `${interaction.user.id}:${interaction.guildId}`;
    availabilitySelections.delete(key);
    const t = await getT(interaction.guildId);
    await interaction.reply({
        embeds: [infoEmbed('', t.availability.cleared)],
        flags: MessageFlags.Ephemeral,
    });
}
