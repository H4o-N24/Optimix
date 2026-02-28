/**
 * /availability コマンド - 空き日登録 & サーバー全体の空き日確認 (i18n対応)
 *
 * サブコマンド:
 * - /availability register: 翌月の空き日をカレンダー選択式で登録
 * - /availability status: サーバー全員の空き日状況をカラーマップで表示
 */

import {
    SlashCommandBuilder,
    type ChatInputCommandInteraction,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder, MessageFlags } from 'discord.js';
import { prisma } from '../lib/prisma.js';
import { getNextMonthInfo, formatDateJP } from '../utils/date.js';
import { infoEmbed, errorEmbed } from '../utils/embeds.js';
import { getT } from '../i18n/index.js';

const MEMBER_COLORS = [
    '🟥', '🟦', '🟩', '🟨', '🟪',
    '🟧', '🔴', '🔵', '🟢', '🟡',
    '🟣', '🔶', '🔷', '🔸', '🔹',
];

export const data = new SlashCommandBuilder()
    .setName('availability')
    .setDescription('空き日の登録・確認 / Register or check availability')
    .addSubcommand((sub) =>
        sub.setName('register').setDescription('翌月の空き日を登録・修正 / Register availability for next month'),
    )
    .addSubcommand((sub) =>
        sub.setName('status').setDescription('サーバー全員の翌月空き日状況 / View everyone\'s availability'),
    );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const sub = interaction.options.getSubcommand();
    if (sub === 'register') await handleRegister(interaction);
    else if (sub === 'status') await handleStatus(interaction);
}

// ─────────────────────────────────────────────
// /availability register
// ─────────────────────────────────────────────
async function handleRegister(interaction: ChatInputCommandInteraction): Promise<void> {
    const t = await getT(interaction.guildId);
    const { year, month, daysInMonth } = getNextMonthInfo();
    const monthStr = String(month).padStart(2, '0');
    const dayLabels = t.availability.dayLabels;

    let existingDates = new Set<string>();
    const guildId = interaction.guildId;
    if (guildId) {
        const existing = await prisma.availability.findMany({
            where: { userId: interaction.user.id, guildId, date: { startsWith: `${year}-${monthStr}` }, status: 'AVAILABLE' },
            select: { date: true },
        });
        existingDates = new Set(existing.map((e) => e.date));
    }

    // 前半メニュー (1〜15日)
    const firstHalfOptions = Array.from({ length: 15 }, (_, i) => {
        const d = i + 1;
        const dateStr = `${year}-${monthStr}-${String(d).padStart(2, '0')}`;
        const dow = new Date(dateStr + 'T00:00:00').getDay();
        const isRegistered = existingDates.has(dateStr);
        return {
            label: `${month}/${d} (${dayLabels[dow]})${isRegistered ? ' ✓' : ''}`,
            value: dateStr,
            emoji: isRegistered ? '✅' : (dow === 0 || dow === 6 ? '🟧' : '⬜'),
            default: isRegistered,
        };
    });

    // 後半メニュー (16日〜末日)
    const secondHalfOptions = Array.from({ length: daysInMonth - 15 }, (_, i) => {
        const d = i + 16;
        const dateStr = `${year}-${monthStr}-${String(d).padStart(2, '0')}`;
        const dow = new Date(dateStr + 'T00:00:00').getDay();
        const isRegistered = existingDates.has(dateStr);
        return {
            label: `${month}/${d} (${dayLabels[dow]})${isRegistered ? ' ✓' : ''}`,
            value: dateStr,
            emoji: isRegistered ? '✅' : (dow === 0 || dow === 6 ? '🟧' : '⬜'),
            default: isRegistered,
        };
    });

    const existingInfo = existingDates.size > 0
        ? `\n${t.availability.currentReg(existingDates.size)} ${Array.from(existingDates).sort().map((d) => `${Number(d.split('-')[2])}日`).join(', ')}\n`
        : `\n${t.availability.noReg}\n`;

    const embed = infoEmbed(
        t.availability.registerTitle(year, month),
        [buildCalendarText(year, month, daysInMonth), existingInfo, t.availability.howTo].join('\n'),
    );

    await interaction.reply({
        embeds: [embed],
        components: [
            new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('availability_select_first')
                    .setPlaceholder(t.availability.firstHalfPlaceholder(month))
                    .setMinValues(0).setMaxValues(15)
                    .addOptions(firstHalfOptions),
            ),
            new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('availability_select_second')
                    .setPlaceholder(t.availability.secondHalfPlaceholder(month, daysInMonth))
                    .setMinValues(0).setMaxValues(secondHalfOptions.length)
                    .addOptions(secondHalfOptions),
            ),
            new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId('availability_confirm').setLabel(t.availability.confirmBtn).setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('availability_clear').setLabel(t.availability.clearBtn).setStyle(ButtonStyle.Secondary),
            ),
        ],
        flags: MessageFlags.Ephemeral,
    });
}

// ─────────────────────────────────────────────
// /availability status
// ─────────────────────────────────────────────
async function handleStatus(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();

    const guildId = interaction.guildId;
    const t = await getT(guildId);

    if (!guildId) {
        await interaction.editReply({ embeds: [errorEmbed(t.common.errorTitle, t.common.guildOnly)] });
        return;
    }

    const { year, month, daysInMonth } = getNextMonthInfo();
    const monthStr = String(month).padStart(2, '0');
    const startDate = `${year}-${monthStr}-01`;
    const endDate = `${year}-${monthStr}-${String(daysInMonth).padStart(2, '0')}`;

    const availabilities = await prisma.availability.findMany({
        where: { guildId, status: 'AVAILABLE', date: { gte: startDate, lte: endDate } },
        include: { user: true },
        orderBy: { date: 'asc' },
    });

    const allUsers = await prisma.user.findMany({
        where: { availabilities: { some: { guildId } } },
    });

    if (allUsers.length === 0) {
        await interaction.editReply({ embeds: [infoEmbed(t.availability.statusTitle(year, month), t.availability.noOneRegistered)] });
        return;
    }

    const userColorMap = new Map<string, string>();
    allUsers.forEach((u, idx) => userColorMap.set(u.userId, MEMBER_COLORS[idx % MEMBER_COLORS.length]));

    const dateUserMap = new Map<string, string[]>();
    for (const av of availabilities) {
        const list = dateUserMap.get(av.date) ?? [];
        list.push(av.userId);
        dateUserMap.set(av.date, list);
    }

    const activeDates = Array.from(dateUserMap.keys()).sort();

    if (activeDates.length === 0) {
        await interaction.editReply({ embeds: [infoEmbed(t.availability.statusTitle(year, month), t.availability.noOneThisMonth(year, month))] });
        return;
    }

    const dayLabels = t.availability.dayLabels;
    const lines = activeDates.map((date) => {
        const d = Number(date.split('-')[2]);
        const dow = new Date(date + 'T00:00:00').getDay();
        const dayLabel = `${String(d).padStart(2, '\u2007')}日(${dayLabels[dow]})`;
        const users = dateUserMap.get(date) ?? [];
        const colorDots = users.map((uid) => userColorMap.get(uid) ?? '⬜').join('');
        const weekend = (dow === 0 || dow === 6) ? ' 🟧' : '';
        return `\`${dayLabel}\` ${colorDots} **${users.length}**${weekend}`;
    });

    const legendLines = allUsers.map((u) => {
        const color = userColorMap.get(u.userId) ?? '⬜';
        const tag = u.discordTag.includes('#') ? u.discordTag : `@${u.discordTag}`;
        return `${color} ${tag}`;
    });

    const registeredIds = new Set(availabilities.map((a) => a.userId));
    const unregistered = allUsers.filter((u) => !registeredIds.has(u.userId));

    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(t.availability.statusTitle(year, month))
        .setDescription(lines.join('\n'))
        .addFields({ name: t.availability.legend, value: legendLines.join('　'), inline: false })
        .setTimestamp();

    if (unregistered.length > 0) {
        embed.addFields({
            name: t.availability.unregistered,
            value: unregistered.map((u) => `<@${u.userId}>`).join(' '),
            inline: false,
        });
    }

    await interaction.editReply({ embeds: [embed] });
}

function buildCalendarText(year: number, month: number, daysInMonth: number): string {
    const header = '`日  月  火  水  木  金  土`';
    const firstDow = new Date(`${year}-${String(month).padStart(2, '0')}-01T00:00:00`).getDay();

    let line = '`';
    for (let i = 0; i < firstDow; i++) line += '    ';

    const lines = [header];
    for (let d = 1; d <= daysInMonth; d++) {
        const dow = (firstDow + d - 1) % 7;
        line += `${String(d).padStart(2, ' ')}  `;
        if (dow === 6 || d === daysInMonth) {
            if (d === daysInMonth && dow !== 6) {
                for (let i = dow + 1; i <= 6; i++) line += '    ';
            }
            lines.push(line.trimEnd() + '`');
            line = '`';
        }
    }
    return lines.join('\n');
}
