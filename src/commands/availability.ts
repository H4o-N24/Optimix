/**
 * /availability コマンド - 空き日登録（カレンダー選択式）
 *
 * 翌月のカレンダーをSelectMenu形式で表示し、
 * 空いている日を複数選択で登録できるUI。
 * 前半(1-15日)と後半(16-末日)の2つのメニューに分割。
 */

import {
    SlashCommandBuilder,
    type ChatInputCommandInteraction,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
} from 'discord.js';
import { getNextMonthInfo } from '../utils/date.js';
import { infoEmbed } from '../utils/embeds.js';

export const data = new SlashCommandBuilder()
    .setName('availability')
    .setDescription('翌月の空き日を登録します（カレンダー選択式）');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const { year, month, daysInMonth } = getNextMonthInfo();
    const monthStr = String(month).padStart(2, '0');
    const dayLabels = ['日', '月', '火', '水', '木', '金', '土'];

    // --- 前半メニュー (1日〜15日) ---
    const firstHalfOptions = [];
    for (let d = 1; d <= 15; d++) {
        const dateStr = `${year}-${monthStr}-${String(d).padStart(2, '0')}`;
        const dow = new Date(dateStr + 'T00:00:00').getDay();
        const dayLabel = dayLabels[dow];
        const isWeekend = dow === 0 || dow === 6;
        const emoji = isWeekend ? '🟧' : '⬜';
        firstHalfOptions.push({
            label: `${month}/${d} (${dayLabel})`,
            value: dateStr,
            emoji,
        });
    }

    const firstHalfMenu = new StringSelectMenuBuilder()
        .setCustomId('availability_select_first')
        .setPlaceholder(`📅 前半: ${month}月1日〜15日から選択`)
        .setMinValues(0)
        .setMaxValues(15)
        .addOptions(firstHalfOptions);

    // --- 後半メニュー (16日〜末日) ---
    const secondHalfOptions = [];
    for (let d = 16; d <= daysInMonth; d++) {
        const dateStr = `${year}-${monthStr}-${String(d).padStart(2, '0')}`;
        const dow = new Date(dateStr + 'T00:00:00').getDay();
        const dayLabel = dayLabels[dow];
        const isWeekend = dow === 0 || dow === 6;
        const emoji = isWeekend ? '🟧' : '⬜';
        secondHalfOptions.push({
            label: `${month}/${d} (${dayLabel})`,
            value: dateStr,
            emoji,
        });
    }

    const secondHalfMenu = new StringSelectMenuBuilder()
        .setCustomId('availability_select_second')
        .setPlaceholder(`📅 後半: ${month}月16日〜${daysInMonth}日から選択`)
        .setMinValues(0)
        .setMaxValues(secondHalfOptions.length)
        .addOptions(secondHalfOptions);

    // --- 確定ボタン ---
    const confirmBtn = new ButtonBuilder()
        .setCustomId('availability_confirm')
        .setLabel('✅ 空き日を確定する')
        .setStyle(ButtonStyle.Success);

    const clearBtn = new ButtonBuilder()
        .setCustomId('availability_clear')
        .setLabel('🗑️ 選択をクリア')
        .setStyle(ButtonStyle.Secondary);

    // --- カレンダーEmbed ---
    const calendarText = buildCalendarText(year, month, daysInMonth);
    const embed = infoEmbed(
        `${year}年${month}月の空き日を登録`,
        [
            calendarText,
            '',
            '**使い方:**',
            '1️⃣ 前半・後半のメニューから空いている日を選択',
            '2️⃣ 「✅ 空き日を確定する」ボタンで登録',
            '',
            '🟧 = 土日 ⬜ = 平日',
        ].join('\n'),
    );

    const row1 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(firstHalfMenu);
    const row2 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(secondHalfMenu);
    const row3 = new ActionRowBuilder<ButtonBuilder>().addComponents(confirmBtn, clearBtn);

    await interaction.reply({
        embeds: [embed],
        components: [row1, row2, row3],
        ephemeral: true,
    });
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
        const dayStr = String(d).padStart(2, ' ');
        line += `${dayStr}  `;

        if (dow === 6 || d === daysInMonth) {
            if (d === daysInMonth && dow !== 6) {
                for (let i = dow + 1; i <= 6; i++) {
                    line += '    ';
                }
            }
            lines.push(line.trimEnd() + '`');
            line = '`';
        }
    }

    return lines.join('\n');
}
