/**
 * /setup コマンド - 初期設定（サーバー専用チャンネル・言語設定）
 *
 * サブコマンド:
 * - /setup channel [channel]: 専用チャンネルを設定
 * - /setup language <ja|en>: 表示言語を設定
 * - /setup reset: チャンネル制限を解除
 */

import {
    SlashCommandBuilder,
    type ChatInputCommandInteraction,
    ChannelType,
    PermissionFlagsBits,
    type TextChannel, MessageFlags } from 'discord.js';
import { prisma } from '../lib/prisma.js';
import { successEmbed, infoEmbed, errorEmbed } from '../utils/embeds.js';
import { getT, getDict } from '../i18n/index.js';

export const data = new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Knotの初期設定を行います / Configure Knot (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
        sub
            .setName('channel')
            .setDescription('Knot専用チャンネルを設定 / Set dedicated channel')
            .addChannelOption((opt) =>
                opt
                    .setName('channel')
                    .setDescription('既存チャンネルを指定（省略時は新規作成）/ Specify existing channel')
                    .addChannelTypes(ChannelType.GuildText)
                    .setRequired(false),
            ),
    )
    .addSubcommand((sub) =>
        sub
            .setName('language')
            .setDescription('表示言語を設定します / Set display language')
            .addStringOption((opt) =>
                opt
                    .setName('lang')
                    .setDescription('言語 / Language')
                    .setRequired(true)
                    .addChoices(
                        { name: '🇯🇵 日本語', value: 'ja' },
                        { name: '🇺🇸 English', value: 'en' },
                    ),
            ),
    )
    .addSubcommand((sub) =>
        sub
            .setName('reset')
            .setDescription('チャンネル制限を解除 / Remove channel restriction'),
    );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
        case 'channel': await handleSetupChannel(interaction); break;
        case 'language': await handleSetupLanguage(interaction); break;
        case 'reset': await handleReset(interaction); break;
    }
}

// ─────────────────────────────────────────────
// /setup channel
// ─────────────────────────────────────────────
async function handleSetupChannel(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const guild = interaction.guild;
    const guildId = interaction.guildId;
    const t = await getT(guildId);

    if (!guild || !guildId) {
        await interaction.editReply({ embeds: [errorEmbed(t.common.errorTitle, t.common.guildOnly)] });
        return;
    }

    const specifiedChannel = interaction.options.getChannel('channel') as TextChannel | null;
    let targetChannel: TextChannel;

    if (specifiedChannel) {
        targetChannel = specifiedChannel;
    } else {
        const guildRecord = await prisma.guild.findUnique({ where: { guildId } });
        if (guildRecord?.botChannelId) {
            const existing = guild.channels.cache.get(guildRecord.botChannelId);
            if (existing) {
                await interaction.editReply({ embeds: [infoEmbed(t.setup.alreadySetTitle, t.setup.alreadySetDesc(guildRecord.botChannelId))] });
                return;
            }
        }

        try {
            targetChannel = await guild.channels.create({
                name: t.setup.channelName,
                type: ChannelType.GuildText,
                topic: t.setup.channelTopic,
                reason: 'Knot setup',
            }) as TextChannel;
        } catch {
            await interaction.editReply({ embeds: [errorEmbed(t.setup.createFailed, t.setup.createFailedDesc)] });
            return;
        }

        await targetChannel.send({ embeds: [infoEmbed(t.setup.welcomeTitle, t.setup.welcomeDesc)] });
    }

    await prisma.guild.upsert({
        where: { guildId },
        create: { guildId, botChannelId: targetChannel.id },
        update: { botChannelId: targetChannel.id },
    });

    await interaction.editReply({ embeds: [successEmbed(t.setup.doneTitle, t.setup.doneDesc(targetChannel.id))] });
}

// ─────────────────────────────────────────────
// /setup language
// ─────────────────────────────────────────────
async function handleSetupLanguage(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const guildId = interaction.guildId;
    if (!guildId) {
        const t = await getT(null);
        await interaction.editReply({ embeds: [errorEmbed(t.common.errorTitle, t.common.guildOnly)] });
        return;
    }

    const lang = interaction.options.getString('lang', true) as 'ja' | 'en';

    await prisma.guild.upsert({
        where: { guildId },
        create: { guildId, language: lang },
        update: { language: lang },
    });

    // 新しい言語の辞書で返答
    const t = getDict(lang);
    await interaction.editReply({
        embeds: [successEmbed(t.setup.languageSetTitle, t.setup.languageSetDesc(lang))],
    });
}

// ─────────────────────────────────────────────
// /setup reset
// ─────────────────────────────────────────────
async function handleReset(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const guildId = interaction.guildId;
    const t = await getT(guildId);

    if (!guildId) {
        await interaction.editReply({ embeds: [errorEmbed(t.common.errorTitle, t.common.guildOnly)] });
        return;
    }

    await prisma.guild.upsert({
        where: { guildId },
        create: { guildId, botChannelId: null },
        update: { botChannelId: null },
    });

    await interaction.editReply({ embeds: [successEmbed(t.setup.resetTitle, t.setup.resetDesc)] });
}
