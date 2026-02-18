/**
 * interactionCreate イベントハンドラ
 *
 * すべてのインタラクション（コマンド、ボタン、SelectMenu）を処理
 */

import {
    type Client,
    Events,
    type Interaction,
    type ButtonInteraction,
    type StringSelectMenuInteraction,
} from 'discord.js';
import { PrismaClient } from '@prisma/client';
import { commands } from '../commands/index.js';
import { joinEvent, cancelEvent } from '../services/participant.js';
import { successEmbed, errorEmbed, infoEmbed } from '../utils/embeds.js';
import { formatDateJP, getNextMonthInfo } from '../utils/date.js';

const prisma = new PrismaClient();

/**
 * ユーザーごとの空き日選択状態を一時保持
 * key: `${userId}:${guildId}`
 */
const availabilitySelections = new Map<string, Set<string>>();

export function registerInteractionHandler(client: Client): void {
    client.on(Events.InteractionCreate, async (interaction: Interaction) => {
        try {
            // スラッシュコマンド
            if (interaction.isChatInputCommand()) {
                const command = commands.get(interaction.commandName);
                if (!command) return;
                await command.execute(interaction);
                return;
            }

            // オートコンプリート
            if (interaction.isAutocomplete()) {
                const command = commands.get(interaction.commandName);
                if (!command || !('autocomplete' in command)) return;
                await (command as any).autocomplete(interaction);
                return;
            }

            // ボタン
            if (interaction.isButton()) {
                await handleButton(interaction);
                return;
            }

            // SelectMenu
            if (interaction.isStringSelectMenu()) {
                await handleSelectMenu(interaction);
                return;
            }
        } catch (error) {
            console.error('❌ インタラクション処理エラー:', error);
            const reply = { embeds: [errorEmbed('エラー', '処理中にエラーが発生しました。')], ephemeral: true };
            if (interaction.isRepliable()) {
                if (interaction.deferred || interaction.replied) {
                    await interaction.followUp(reply);
                } else {
                    await interaction.reply(reply);
                }
            }
        }
    });
}

/**
 * ボタンハンドラ
 */
async function handleButton(interaction: ButtonInteraction): Promise<void> {
    const customId = interaction.customId;

    // --- 空き日: 確定ボタン ---
    if (customId === 'availability_confirm') {
        await handleAvailabilityConfirm(interaction);
        return;
    }

    // --- 空き日: クリアボタン ---
    if (customId === 'availability_clear') {
        const key = `${interaction.user.id}:${interaction.guildId}`;
        availabilitySelections.delete(key);
        await interaction.reply({
            embeds: [infoEmbed('クリア', '選択をクリアしました。もう一度メニューから選択してください。')],
            ephemeral: true,
        });
        return;
    }

    // --- イベント: 参加/キャンセルボタン ---
    const [action, eventId] = customId.split(':');
    if (!eventId) return;

    // User をupsert
    await prisma.user.upsert({
        where: { userId: interaction.user.id },
        create: { userId: interaction.user.id, discordTag: interaction.user.tag },
        update: { discordTag: interaction.user.tag },
    });

    if (action === 'event_join') {
        await interaction.deferReply({ ephemeral: true });
        const result = await joinEvent(eventId, interaction.user.id);
        const embed = result.success
            ? successEmbed('参加登録', result.message)
            : infoEmbed('参加登録', result.message);
        await interaction.editReply({ embeds: [embed] });
    } else if (action === 'event_cancel') {
        await interaction.deferReply({ ephemeral: true });
        const result = await cancelEvent(eventId, interaction.user.id);
        const embed = result.success
            ? successEmbed('キャンセル', result.message)
            : errorEmbed('キャンセル', result.message);
        await interaction.editReply({ embeds: [embed] });

        // 繰り上げ通知
        if (result.promotedUserId) {
            await interaction.followUp({
                content: `🎉 <@${result.promotedUserId}> キャンセル待ちから繰り上げで参加が確定しました！`,
            });
        }
    }
}

/**
 * SelectMenuハンドラ
 */
async function handleSelectMenu(interaction: StringSelectMenuInteraction): Promise<void> {
    const customId = interaction.customId;

    // --- 空き日: 前半/後半メニュー ---
    if (customId === 'availability_select_first' || customId === 'availability_select_second') {
        await handleAvailabilitySelect(interaction);
        return;
    }

    // --- イベント: 候補日選択 ---
    const [action, eventId] = customId.split(':');
    if (action !== 'event_select_date' || !eventId) return;

    await interaction.deferReply();
    const selectedDate = interaction.values[0];

    const event = await prisma.event.update({
        where: { id: eventId },
        data: {
            date: selectedDate,
            status: 'CONFIRMED',
        },
    });

    await interaction.editReply({
        embeds: [
            successEmbed(
                'イベント日程が確定しました！',
                `**${event.title}**\n📅 ${formatDateJP(selectedDate)}\n\n参加する方は下のボタンを押してください。`,
            ),
        ],
        components: [
            {
                type: 1,
                components: [
                    {
                        type: 2,
                        custom_id: `event_join:${event.id}`,
                        label: '参加',
                        style: 3,
                        emoji: { name: '✅' },
                    },
                    {
                        type: 2,
                        custom_id: `event_cancel:${event.id}`,
                        label: 'キャンセル',
                        style: 4,
                        emoji: { name: '❌' },
                    },
                ],
            },
        ],
    });
}

/**
 * 空き日のSelectMenu選択ハンドラ
 * 前半・後半の選択をマージして一時保持
 */
async function handleAvailabilitySelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const key = `${interaction.user.id}:${interaction.guildId}`;
    const isFirst = interaction.customId === 'availability_select_first';

    // 既存の選択を取得
    let selections = availabilitySelections.get(key);
    if (!selections) {
        selections = new Set();
        availabilitySelections.set(key, selections);
    }

    // 対応する半分をクリアして新しい選択で置き換え
    const { year, month } = getNextMonthInfo();
    const monthStr = String(month).padStart(2, '0');

    if (isFirst) {
        // 前半(1-15)をクリア
        for (let d = 1; d <= 15; d++) {
            selections.delete(`${year}-${monthStr}-${String(d).padStart(2, '0')}`);
        }
    } else {
        // 後半(16-末日)をクリア
        for (let d = 16; d <= 31; d++) {
            selections.delete(`${year}-${monthStr}-${String(d).padStart(2, '0')}`);
        }
    }

    // 新しい選択を追加
    for (const val of interaction.values) {
        selections.add(val);
    }

    const sorted = Array.from(selections).sort();
    const dateList = sorted.map(formatDateJP).join('\n') || 'なし';

    await interaction.reply({
        embeds: [
            infoEmbed(
                `📅 現在の選択（${sorted.length}日）`,
                `${dateList}\n\n選択を変更できます。最後に **「✅ 空き日を確定する」** ボタンを押してください。`,
            ),
        ],
        ephemeral: true,
    });
}

/**
 * 空き日の確定ボタンハンドラ
 * 一時保持している選択をDBに保存
 */
async function handleAvailabilityConfirm(interaction: ButtonInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const guildId = interaction.guildId;
    if (!guildId) {
        await interaction.editReply({ embeds: [errorEmbed('エラー', 'サーバー内でのみ使用できます。')] });
        return;
    }

    const key = `${interaction.user.id}:${guildId}`;
    const selections = availabilitySelections.get(key);

    if (!selections || selections.size === 0) {
        await interaction.editReply({
            embeds: [errorEmbed('未選択', 'まだ日付が選択されていません。\n上のメニューから空いている日を選択してください。')],
        });
        return;
    }

    // Guild と User をupsert
    await prisma.guild.upsert({
        where: { guildId },
        create: { guildId },
        update: {},
    });
    await prisma.user.upsert({
        where: { userId: interaction.user.id },
        create: { userId: interaction.user.id, discordTag: interaction.user.tag },
        update: { discordTag: interaction.user.tag },
    });

    const dateStrings = Array.from(selections).sort();
    const { year, month } = getNextMonthInfo();
    const monthStr = String(month).padStart(2, '0');

    // 既存の同月データを削除
    await prisma.availability.deleteMany({
        where: {
            userId: interaction.user.id,
            guildId,
            date: { startsWith: `${year}-${monthStr}` },
        },
    });

    // 新しいデータを登録
    await prisma.availability.createMany({
        data: dateStrings.map((date) => ({
            userId: interaction.user.id,
            guildId,
            date,
            status: 'AVAILABLE',
        })),
    });

    // 一時データをクリア
    availabilitySelections.delete(key);

    const formattedDates = dateStrings.map(formatDateJP).join('\n');
    await interaction.editReply({
        embeds: [
            successEmbed(
                '空き日を登録しました！',
                `**${dateStrings.length}日分** の空き日を登録しました。\n\n${formattedDates}`,
            ),
        ],
    });
}
