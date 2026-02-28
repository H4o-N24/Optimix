/**
 * /help コマンド - ヘルプ表示 (i18n対応)
 */

import {
    SlashCommandBuilder,
    type ChatInputCommandInteraction,
    EmbedBuilder, MessageFlags } from 'discord.js';
import { getT } from '../i18n/index.js';

const BRAND_COLOR = 0x5865F2 as const;

export const data = new SlashCommandBuilder()
    .setName('help')
    .setDescription('Knotの使い方を表示 / Show Knot usage');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const t = await getT(interaction.guildId);
    const h = t.help;

    const embed = new EmbedBuilder()
        .setColor(BRAND_COLOR)
        .setTitle(h.title)
        .setDescription(h.description)
        .addFields(
            { name: h.availabilityField.name, value: h.availabilityField.value, inline: false },
            { name: h.eventCreateField.name, value: h.eventCreateField.value, inline: false },
            { name: h.eventListField.name, value: h.eventListField.value, inline: false },
            { name: h.eventManageField.name, value: h.eventManageField.value, inline: false },
            { name: h.autoField.name, value: h.autoField.value, inline: false },
            { name: h.setupField.name, value: h.setupField.value, inline: false },
        )
        .setFooter({ text: h.footer });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
