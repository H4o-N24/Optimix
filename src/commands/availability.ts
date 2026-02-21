/**
 * /availability コマンド - 空き日登録 & サーバー全体の空き日確認
 *
 * サブコマンド:
 * - /availability register: 翌月の空き日をカレンダー選択式で登録
 * - /availability status: サーバー全員の空き日状況をカラー絵文字で表示
 */

import {
    SlashCommandBuilder,
    type ChatInputCommandInteraction,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
} from 'discord.js';
import { prisma } from '../lib/prisma.js';
import { getNextMonthInfo, formatDateJP } from '../utils/date.js';
import { infoEmbed, errorEmbed } from '../utils/embeds.js';


/** メンバーごとに割り当てるカラー絵文字（最大15人まで対応） */
const MEMBER_COLORS = [
    '🟥', '🟦', '🟩', '🟨', '🟪',
    '🟧', '🔴', '🔵', '🟢', '🟡',
    '🟣', '🔶', '🔷', '🔸', '🔹',
];

/**
 * 外部から呼べるように: 既存の登録をインメモリに読み込む
 */
export async function prePopulateSelections(
    selectionMap: Map<string, Set<string>>,
    userId: string,
    guildId: string,
): Promise<Set<string>> {
    const { year, month } = getNextMonthInfo();
    const monthStr = String(month).padStart(2, '0');
    const key = `${userId}:${guildId}`;

    const existing = await prisma.availability.findMany({
        where: {
            userId,
            guildId,
            date: { startsWith: `${year}-${monthStr}` },
            status: 'AVAILABLE',
        },
        select: { date: true },
    });

    const existingDates = new Set(existing.map((e) => e.date));
    selectionMap.set(key, new Set(existingDates));
    return existingDates;
}

export const data = new SlashCommandBuilder()
    .setName('availability')
    .setDescription('空き日の登録・確認')
    .addSubcommand((sub) =>
        sub
            .setName('register')
            .setDescription('翌月の空き日を登録・修正します（カレンダー選択式）'),
    )
    .addSubcommand((sub) =>
        sub
            .setName('status')
            .setDescription('サーバー全員の翌月空き日状況をカラーマップで表示します'),
    );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const sub = interaction.options.getSubcommand();
    if (sub === 'register') {
        await handleRegister(interaction);
    } else if (sub === 'status') {
        await handleStatus(interaction);
    }
}

// ─────────────────────────────────────────────
// /availability register
// ─────────────────────────────────────────────
async function handleRegister(interaction: ChatInputCommandInteraction): Promise<void> {
    const { year, month, daysInMonth } = getNextMonthInfo();
    const monthStr = String(month).padStart(2, '0');
    const dayLabels = ['日', '月', '火', '水', '木', '金', '土'];

    const guildId = interaction.guildId;
    let existingDates = new Set<string>();
    if (guildId) {
        const existing = await prisma.availability.findMany({
            where: {
                userId: interaction.user.id,
                guildId,
                date: { startsWith: `${year}-${monthStr}` },
                status: 'AVAILABLE',
            },
            select: { date: true },
        });
        existingDates = new Set(existing.map((e) => e.date));
    }

    // 前半メニュー (1〜15日)
    const firstHalfOptions = [];
    for (let d = 1; d <= 15; d++) {
        const dateStr = `${year}-${monthStr}-${String(d).padStart(2, '0')}`;
        const dow = new Date(dateStr + 'T00:00:00').getDay();
        const isWeekend = dow === 0 || dow === 6;
        const isRegistered = existingDates.has(dateStr);
        firstHalfOptions.push({
            label: `${month}/${d} (${dayLabels[dow]})${isRegistered ? ' ✓' : ''}`,
            value: dateStr,
            emoji: isRegistered ? '✅' : isWeekend ? '🟧' : '⬜',
            default: isRegistered,
        });
    }

    const firstHalfMenu = new StringSelectMenuBuilder()
        .setCustomId('availability_select_first')
        .setPlaceholder(`📅 前半: ${month}月1日〜15日から選択`)
        .setMinValues(0)
        .setMaxValues(15)
        .addOptions(firstHalfOptions);

    // 後半メニュー (16日〜末日)
    const secondHalfOptions = [];
    for (let d = 16; d <= daysInMonth; d++) {
        const dateStr = `${year}-${monthStr}-${String(d).padStart(2, '0')}`;
        const dow = new Date(dateStr + 'T00:00:00').getDay();
        const isWeekend = dow === 0 || dow === 6;
        const isRegistered = existingDates.has(dateStr);
        secondHalfOptions.push({
            label: `${month}/${d} (${dayLabels[dow]})${isRegistered ? ' ✓' : ''}`,
            value: dateStr,
            emoji: isRegistered ? '✅' : isWeekend ? '🟧' : '⬜',
            default: isRegistered,
        });
    }

    const secondHalfMenu = new StringSelectMenuBuilder()
        .setCustomId('availability_select_second')
        .setPlaceholder(`📅 後半: ${month}月16日〜${daysInMonth}日から選択`)
        .setMinValues(0)
        .setMaxValues(secondHalfOptions.length)
        .addOptions(secondHalfOptions);

    const confirmBtn = new ButtonBuilder()
        .setCustomId('availability_confirm')
        .setLabel('✅ 空き日を確定する')
        .setStyle(ButtonStyle.Success);

    const clearBtn = new ButtonBuilder()
        .setCustomId('availability_clear')
        .setLabel('🗑️ 選択をクリア')
        .setStyle(ButtonStyle.Secondary);

    const calendarText = buildCalendarText(year, month, daysInMonth);
    const existingInfo = existingDates.size > 0
        ? `\n✅ **現在の登録（${existingDates.size}日）:** ${Array.from(existingDates).sort().map(d => `${Number(d.split('-')[2])}日`).join(', ')}\n`
        : '\n📌 **現在の登録:** なし\n';

    const embed = infoEmbed(
        `${year}年${month}月の空き日を登録`,
        [
            calendarText,
            existingInfo,
            '**使い方:**',
            '1️⃣ 前半・後半のメニューから空いている日を選択',
            '2️⃣ 「✅ 空き日を確定する」ボタンで登録',
            '',
            '💡 既に登録済みの日は ✅ で表示・プリセット済み',
            '🟧 = 土日 ⬜ = 平日',
        ].join('\n'),
    );

    await interaction.reply({
        embeds: [embed],
        components: [
            new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(firstHalfMenu),
            new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(secondHalfMenu),
            new ActionRowBuilder<ButtonBuilder>().addComponents(confirmBtn, clearBtn),
        ],
        ephemeral: true,
    });
}

// ─────────────────────────────────────────────
// /availability status
// ─────────────────────────────────────────────
async function handleStatus(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();

    const guildId = interaction.guildId;
    if (!guildId) {
        await interaction.editReply({ embeds: [errorEmbed('エラー', 'サーバー内でのみ使用できます。')] });
        return;
    }

    const { year, month, daysInMonth } = getNextMonthInfo();
    const monthStr = String(month).padStart(2, '0');
    const startDate = `${year}-${monthStr}-01`;
    const endDate = `${year}-${monthStr}-${String(daysInMonth).padStart(2, '0')}`;

    // 翌月の空き日を全員分取得
    const availabilities = await prisma.availability.findMany({
        where: {
            guildId,
            status: 'AVAILABLE',
            date: { gte: startDate, lte: endDate },
        },
        include: { user: true },
        orderBy: { date: 'asc' },
    });

    // ギルドに登録されているユーザー全員取得
    const allUsers = await prisma.user.findMany({
        where: {
            availabilities: { some: { guildId } },
        },
    });

    if (allUsers.length === 0) {
        await interaction.editReply({
            embeds: [infoEmbed('空き日状況', 'まだ誰も空き日を登録していません。\n`/availability register` で登録しましょう！')],
        });
        return;
    }

    // ユーザーに色を割り当て（登録順）
    const userColorMap = new Map<string, string>(); // userId → emoji
    allUsers.forEach((u, idx) => {
        userColorMap.set(u.userId, MEMBER_COLORS[idx % MEMBER_COLORS.length]);
    });

    // 日付ごとに参加可能ユーザーをまとめる
    const dateUserMap = new Map<string, string[]>(); // date → userId[]
    for (const av of availabilities) {
        const list = dateUserMap.get(av.date) ?? [];
        list.push(av.userId);
        dateUserMap.set(av.date, list);
    }

    // 空き日が1件以上ある日のみ表示
    const activeDates = Array.from(dateUserMap.keys()).sort();

    // 未登録ユーザー
    const registeredUserIds = new Set(availabilities.map((a) => a.userId));
    const unregisteredUsers = allUsers.filter((u) => !registeredUserIds.has(u.userId));

    // カラーマップ表示を構築
    const dayLabels = ['日', '月', '火', '水', '木', '金', '土'];
    const lines: string[] = [];
    for (const date of activeDates) {
        const d = Number(date.split('-')[2]);
        const dow = new Date(date + 'T00:00:00').getDay();
        const isWeekend = dow === 0 || dow === 6;
        const dayLabel = `${String(d).padStart(2, '\u2007')}日(${dayLabels[dow]})`;
        const users = dateUserMap.get(date) ?? [];
        const colorDots = users.map((uid) => userColorMap.get(uid) ?? '⬜').join('');
        const countStr = `${users.length}人`;
        const weekend = isWeekend ? ' 🟧' : '';
        lines.push(`\`${dayLabel}\` ${colorDots} **${countStr}**${weekend}`);
    }

    if (lines.length === 0) {
        await interaction.editReply({
            embeds: [infoEmbed('空き日状況', `${year}年${month}月はまだ誰も空き日を登録していません。`)],
        });
        return;
    }

    // 凡例
    const legendLines = allUsers.map((u) => {
        const color = userColorMap.get(u.userId) ?? '⬜';
        const tag = u.discordTag.includes('#') ? u.discordTag : `@${u.discordTag}`;
        return `${color} ${tag}`;
    });

    // Embedを構築（25フィールド上限のため分割）
    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`📊 ${year}年${month}月 空き日状況`)
        .setDescription(lines.join('\n'))
        .addFields(
            {
                name: '👤 凡例（メンバーカラー）',
                value: legendLines.join('　'),
                inline: false,
            },
        )
        .setTimestamp();

    if (unregisteredUsers.length > 0) {
        const unregisteredMentions = unregisteredUsers
            .map((u) => `<@${u.userId}>`)
            .join(' ');
        embed.addFields({
            name: '📝 未登録メンバー',
            value: unregisteredMentions,
            inline: false,
        });
    }

    await interaction.editReply({ embeds: [embed] });
}

/**
 * カレンダーテキストを生成（月表示）
 */
function buildCalendarText(year: number, month: number, daysInMonth: number): string {
    const header = '`日  月  火  水  木  金  土`';
    const firstDow = new Date(`${year}-${String(month).padStart(2, '0')}-01T00:00:00`).getDay();

    let line = '`';
    for (let i = 0; i < firstDow; i++) {
        line += '    ';
    }

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
