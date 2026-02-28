/**
 * /premium コマンド - プレミアムプラン管理
 *
 * サブコマンド:
 * - /premium activate <code>: ライセンスコードを有効化（管理者のみ）
 * - /premium status: 現在のプラン状況を確認
 */

import {
    SlashCommandBuilder,
    type ChatInputCommandInteraction,
    PermissionFlagsBits, MessageFlags } from 'discord.js';
import { prisma } from '../lib/prisma.js';
import { successEmbed, infoEmbed, errorEmbed } from '../utils/embeds.js';
import { getT } from '../i18n/index.js';

export const data = new SlashCommandBuilder()
    .setName('premium')
    .setDescription('プレミアムプランの管理 / Manage premium plan')
    .addSubcommand((sub) =>
        sub
            .setName('activate')
            .setDescription('ライセンスコードを有効化 / Activate a license code (Admin only)')
            .addStringOption((opt) =>
                opt
                    .setName('code')
                    .setDescription('BOOTHで購入したライセンスコード / License code from BOOTH')
                    .setRequired(true),
            ),
    )
    .addSubcommand((sub) =>
        sub.setName('status').setDescription('現在のプラン状況 / Check current plan status'),
    );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'activate') await handleActivate(interaction);
    else if (subcommand === 'status') await handleStatus(interaction);
}

// ─────────────────────────────────────────────
// /premium activate
// ─────────────────────────────────────────────
async function handleActivate(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const guildId = interaction.guildId;
    const t = await getT(guildId);

    if (!guildId) {
        await interaction.editReply({ embeds: [errorEmbed(t.common.errorTitle, t.common.guildOnly)] });
        return;
    }

    // 管理者のみ実行可能
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        await interaction.editReply({ embeds: [errorEmbed(t.common.errorTitle, '\u30b3\u30de\u30f3\u30c9\u306f\u7ba1\u7406\u8005\u306e\u307f\u5b9f\u884c\u3067\u304d\u307e\u3059\u3002 / This command requires Manage Server permission.')] });
        return;
    }

    const code = interaction.options.getString('code', true).trim().toUpperCase();

    // コードを検索
    const premiumCode = await prisma.premiumCode.findUnique({ where: { code } });

    if (!premiumCode || premiumCode.usedByGuildId) {
        await interaction.editReply({ embeds: [errorEmbed(t.premium.invalidCodeTitle, t.premium.invalidCode)] });
        return;
    }

    // 既にプレミアム中かチェック
    const guild = await prisma.guild.findUnique({
        where: { guildId },
        select: { planType: true, premiumExpiresAt: true },
    });

    const now = new Date();
    if (guild?.planType === 'PREMIUM' && guild.premiumExpiresAt && guild.premiumExpiresAt > now) {
        const expires = formatDate(guild.premiumExpiresAt);
        await interaction.editReply({ embeds: [infoEmbed(t.premium.alreadyPremiumTitle, t.premium.alreadyPremium(expires))] });
        return;
    }

    // 有効期限を計算
    const isYearly = premiumCode.planType === 'YEARLY';
    const expiresAt = new Date(now);
    if (isYearly) {
        expiresAt.setFullYear(expiresAt.getFullYear() + 1);
    } else {
        expiresAt.setMonth(expiresAt.getMonth() + 1);
    }

    // トランザクションで一括更新
    await prisma.$transaction([
        prisma.premiumCode.update({
            where: { code },
            data: { usedByGuildId: guildId, usedAt: now },
        }),
        prisma.guild.upsert({
            where: { guildId },
            create: { guildId, planType: 'PREMIUM', premiumExpiresAt: expiresAt },
            update: { planType: 'PREMIUM', premiumExpiresAt: expiresAt },
        }),
    ]);

    const guildName = interaction.guild?.name ?? guildId;
    const expires = formatDate(expiresAt);
    const message = isYearly
        ? t.premium.activateYearly(guildName, expires)
        : t.premium.activateMonthly(guildName, expires);

    await interaction.editReply({ embeds: [successEmbed(t.premium.activateTitle, message)] });
}

// ─────────────────────────────────────────────
// /premium status
// ─────────────────────────────────────────────
async function handleStatus(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const guildId = interaction.guildId;
    const t = await getT(guildId);

    if (!guildId) {
        await interaction.editReply({ embeds: [errorEmbed(t.common.errorTitle, t.common.guildOnly)] });
        return;
    }

    const guild = await prisma.guild.findUnique({
        where: { guildId },
        select: { planType: true, premiumExpiresAt: true, eventCountThisMonth: true },
    });

    const now = new Date();
    const isPremium = guild?.planType === 'PREMIUM' && guild.premiumExpiresAt && guild.premiumExpiresAt > now;

    if (isPremium && guild?.premiumExpiresAt) {
        const expires = formatDate(guild.premiumExpiresAt);
        const daysLeft = Math.ceil((guild.premiumExpiresAt.getTime() - now.getTime()) / 86_400_000);
        const remaining = t.premium.daysLeft(daysLeft);
        await interaction.editReply({ embeds: [successEmbed(t.premium.statusTitle, t.premium.statusPremium(expires, remaining))] });
    } else {
        const used = guild?.eventCountThisMonth ?? 0;
        await interaction.editReply({ embeds: [infoEmbed(t.premium.statusTitle, t.premium.statusFree(used))] });
    }
}

function formatDate(date: Date): string {
    return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
}
