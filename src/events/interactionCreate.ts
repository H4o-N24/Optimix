/**
 * interactionCreate イベントハンドラ
 *
 * すべてのインタラクション（コマンド、ボタン、Modal、SelectMenu）を処理
 */

import {
    type Client,
    Events,
    type Interaction,
    type ButtonInteraction,
    type StringSelectMenuInteraction,
    type ModalSubmitInteraction,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} from 'discord.js';
import { PrismaClient } from '@prisma/client';
import { commands } from '../commands/index.js';
import { joinEvent, cancelEvent } from '../services/participant.js';
import { successEmbed, errorEmbed, infoEmbed } from '../utils/embeds.js';
import { formatDateJP, getNextMonthInfo } from '../utils/date.js';

const prisma = new PrismaClient();

/**
 * ユーザーごとの空き日選択状態を一時保持
 */
const availabilitySelections = new Map<string, Set<string>>();

export function registerInteractionHandler(client: Client): void {
    client.on(Events.InteractionCreate, async (interaction: Interaction) => {
        try {
            if (interaction.isChatInputCommand()) {
                const command = commands.get(interaction.commandName);
                if (!command) return;
                await command.execute(interaction);
                return;
            }

            if (interaction.isAutocomplete()) {
                const command = commands.get(interaction.commandName);
                if (!command || !('autocomplete' in command)) return;
                await (command as any).autocomplete(interaction);
                return;
            }

            if (interaction.isModalSubmit()) {
                await handleModalSubmit(interaction);
                return;
            }

            if (interaction.isButton()) {
                await handleButton(interaction);
                return;
            }

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

// =====================================
// ボタンハンドラ
// =====================================
async function handleButton(interaction: ButtonInteraction): Promise<void> {
    const customId = interaction.customId;

    // --- 空き日: 確定 ---
    if (customId === 'availability_confirm') {
        await handleAvailabilityConfirm(interaction);
        return;
    }

    // --- 空き日: クリア ---
    if (customId === 'availability_clear') {
        const key = `${interaction.user.id}:${interaction.guildId}`;
        availabilitySelections.delete(key);
        await interaction.reply({
            embeds: [infoEmbed('クリア', '選択をクリアしました。もう一度メニューから選択してください。')],
            ephemeral: true,
        });
        return;
    }

    // --- イベント管理: 詳細表示 ---
    if (customId.startsWith('event_manage_info:')) {
        const eventId = customId.split(':')[1];
        await showEventDetail(interaction, eventId);
        return;
    }

    // --- イベント管理: 編集（Modal表示） ---
    if (customId.startsWith('event_manage_edit:')) {
        const eventId = customId.split(':')[1];
        await showEditModal(interaction, eventId);
        return;
    }

    // --- イベント管理: 単一削除 ---
    if (customId.startsWith('event_manage_delete:')) {
        const eventId = customId.split(':')[1];
        await handleSingleDelete(interaction, eventId);
        return;
    }

    // --- イベント管理: まとめて削除ボタン → SelectMenuを表示 ---
    if (customId === 'event_batch_delete') {
        await showBatchDeleteMenu(interaction);
        return;
    }

    // --- イベント: 参加/キャンセル ---
    const [action, eventId] = customId.split(':');
    if (!eventId) return;

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

        if (result.promotedUserId) {
            await interaction.followUp({
                content: `🎉 <@${result.promotedUserId}> キャンセル待ちから繰り上げで参加が確定しました！`,
            });
        }
    }
}

// =====================================
// SelectMenuハンドラ
// =====================================
async function handleSelectMenu(interaction: StringSelectMenuInteraction): Promise<void> {
    const customId = interaction.customId;

    // --- 空き日: 前半/後半 ---
    if (customId === 'availability_select_first' || customId === 'availability_select_second') {
        await handleAvailabilitySelect(interaction);
        return;
    }

    // --- イベント管理: イベント選択 → 詳細 + アクションボタン ---
    if (customId === 'event_manage_select') {
        const eventId = interaction.values[0];
        await showEventManagePanel(interaction, eventId);
        return;
    }

    // --- イベント管理: まとめて削除実行 ---
    if (customId === 'event_delete_select') {
        await handleBatchDeleteConfirm(interaction);
        return;
    }

    // --- イベント: 候補日選択 ---
    const [action, eventId] = customId.split(':');
    if (action !== 'event_select_date' || !eventId) return;

    await interaction.deferReply();
    const selectedDate = interaction.values[0];

    const event = await prisma.event.update({
        where: { id: eventId },
        data: { date: selectedDate, status: 'CONFIRMED' },
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
                    { type: 2, custom_id: `event_join:${event.id}`, label: '参加', style: 3, emoji: { name: '✅' } },
                    { type: 2, custom_id: `event_cancel:${event.id}`, label: 'キャンセル', style: 4, emoji: { name: '❌' } },
                ],
            },
        ],
    });
}

// =====================================
// Modalハンドラ
// =====================================
async function handleModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
    // --- イベント編集 Modal ---
    if (interaction.customId.startsWith('event_edit_modal:')) {
        await handleEditSubmit(interaction);
        return;
    }
}

// =====================================
// イベント管理パネル（選択後）
// =====================================
async function showEventManagePanel(interaction: StringSelectMenuInteraction, eventId: string): Promise<void> {
    const event = await prisma.event.findUnique({
        where: { id: eventId },
        include: {
            participants: { include: { user: true }, orderBy: { joinedAt: 'asc' } },
            requirements: true,
        },
    });

    if (!event) {
        await interaction.reply({ embeds: [errorEmbed('エラー', 'イベントが見つかりません。')], ephemeral: true });
        return;
    }

    const confirmed = event.participants.filter((p) => p.status === 'CONFIRMED');
    const waitlisted = event.participants.filter((p) => p.status === 'WAITLISTED');
    const required = event.requirements.map((r) => `<@${r.requiredUserId}>`);

    const statusEmoji = event.status === 'CONFIRMED' ? '✅ 確定' : '📝 計画中';
    const dateStr = event.date ? formatDateJP(event.date) : '未定';
    const maxStr = event.maxParticipants ? `/${event.maxParticipants}` : '';

    let description = [
        `**ステータス:** ${statusEmoji}`,
        `**日程:** ${dateStr}`,
        `**最低人数:** ${event.minParticipants}人`,
        `**参加確定:** ${confirmed.length}${maxStr}人`,
    ];

    if (confirmed.length > 0) {
        description.push(`> ${confirmed.map((p) => `<@${p.userId}>`).join(', ')}`);
    }
    if (waitlisted.length > 0) {
        description.push(`**キャンセル待ち:** ${waitlisted.length}人`);
        description.push(`> ${waitlisted.map((p) => `<@${p.userId}>`).join(', ')}`);
    }
    if (required.length > 0) {
        description.push(`**必須メンバー:** ${required.join(', ')}`);
    }

    // アクションボタン
    const infoBtn = new ButtonBuilder()
        .setCustomId(`event_manage_info:${event.id}`)
        .setLabel('📋 参加')
        .setStyle(ButtonStyle.Success);

    const editBtn = new ButtonBuilder()
        .setCustomId(`event_manage_edit:${event.id}`)
        .setLabel('✏️ 編集')
        .setStyle(ButtonStyle.Primary);

    const deleteBtn = new ButtonBuilder()
        .setCustomId(`event_manage_delete:${event.id}`)
        .setLabel('🗑️ 削除')
        .setStyle(ButtonStyle.Danger);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(infoBtn, editBtn, deleteBtn);

    await interaction.reply({
        embeds: [infoEmbed(`⚙️ ${event.title}`, description.join('\n'))],
        components: [row],
        ephemeral: true,
    });
}

// =====================================
// イベント詳細表示（参加ボタン付き・全員に公開）
// =====================================
async function showEventDetail(interaction: ButtonInteraction, eventId: string): Promise<void> {
    const event = await prisma.event.findUnique({
        where: { id: eventId },
        include: {
            participants: { include: { user: true }, orderBy: { joinedAt: 'asc' } },
            requirements: true,
        },
    });

    if (!event) {
        await interaction.reply({ embeds: [errorEmbed('エラー', 'イベントが見つかりません。')], ephemeral: true });
        return;
    }

    const confirmed = event.participants.filter((p) => p.status === 'CONFIRMED');
    const waitlisted = event.participants.filter((p) => p.status === 'WAITLISTED');
    const maxStr = event.maxParticipants ? `/${event.maxParticipants}` : '';
    const dateStr = event.date ? formatDateJP(event.date) : '未定';

    const fields = [
        `📅 **日程:** ${dateStr}`,
        `👥 **参加者:** ${confirmed.length}${maxStr}人`,
    ];
    if (confirmed.length > 0) {
        fields.push(`> ${confirmed.map((p) => `<@${p.userId}>`).join(', ')}`);
    }
    if (waitlisted.length > 0) {
        fields.push(`⏳ **キャンセル待ち:** ${waitlisted.map((p) => `<@${p.userId}>`).join(', ')}`);
    }

    const joinBtn = new ButtonBuilder()
        .setCustomId(`event_join:${event.id}`)
        .setLabel('参加')
        .setStyle(ButtonStyle.Success)
        .setEmoji('✅');

    const cancelBtn = new ButtonBuilder()
        .setCustomId(`event_cancel:${event.id}`)
        .setLabel('キャンセル')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('❌');

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(joinBtn, cancelBtn);

    await interaction.reply({
        embeds: [infoEmbed(`📌 ${event.title}`, fields.join('\n'))],
        components: [row],
    });
}

// =====================================
// 編集Modal表示
// =====================================
async function showEditModal(interaction: ButtonInteraction, eventId: string): Promise<void> {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) {
        await interaction.reply({ embeds: [errorEmbed('エラー', 'イベントが見つかりません。')], ephemeral: true });
        return;
    }

    const modal = new ModalBuilder()
        .setCustomId(`event_edit_modal:${eventId}`)
        .setTitle('イベントを編集');

    const titleInput = new TextInputBuilder()
        .setCustomId('edit_title')
        .setLabel('イベント名')
        .setStyle(TextInputStyle.Short)
        .setValue(event.title)
        .setRequired(true);

    const minInput = new TextInputBuilder()
        .setCustomId('edit_min')
        .setLabel('最低参加人数')
        .setStyle(TextInputStyle.Short)
        .setValue(String(event.minParticipants))
        .setRequired(false);

    const maxInput = new TextInputBuilder()
        .setCustomId('edit_max')
        .setLabel('定員（0 = 無制限）')
        .setStyle(TextInputStyle.Short)
        .setValue(String(event.maxParticipants ?? 0))
        .setRequired(false);

    modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(minInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(maxInput),
    );

    await interaction.showModal(modal);
}

// =====================================
// 編集Modal送信
// =====================================
async function handleEditSubmit(interaction: ModalSubmitInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const eventId = interaction.customId.split(':')[1];
    const event = await prisma.event.findUnique({ where: { id: eventId } });

    if (!event) {
        await interaction.editReply({ embeds: [errorEmbed('エラー', 'イベントが見つかりません。')] });
        return;
    }

    const newTitle = interaction.fields.getTextInputValue('edit_title');
    const newMinStr = interaction.fields.getTextInputValue('edit_min');
    const newMaxStr = interaction.fields.getTextInputValue('edit_max');

    const updateData: { title?: string; minParticipants?: number; maxParticipants?: number | null } = {};
    const changes: string[] = [];

    if (newTitle && newTitle !== event.title) {
        updateData.title = newTitle;
        changes.push(`📝 イベント名: **${event.title}** → **${newTitle}**`);
    }

    const newMin = parseInt(newMinStr);
    if (!isNaN(newMin) && newMin !== event.minParticipants) {
        updateData.minParticipants = newMin;
        changes.push(`👥 最低人数: **${event.minParticipants}** → **${newMin}**`);
    }

    const newMax = parseInt(newMaxStr);
    if (!isNaN(newMax)) {
        const maxValue = newMax === 0 ? null : newMax;
        if (maxValue !== event.maxParticipants) {
            updateData.maxParticipants = maxValue;
            changes.push(`📊 定員: **${event.maxParticipants ?? '無制限'}** → **${maxValue ?? '無制限'}**`);
        }
    }

    if (changes.length === 0) {
        await interaction.editReply({ embeds: [infoEmbed('変更なし', '変更はありませんでした。')] });
        return;
    }

    await prisma.event.update({ where: { id: eventId }, data: updateData });

    await interaction.editReply({
        embeds: [successEmbed('イベントを更新しました', changes.join('\n'))],
    });
}

// =====================================
// 単一削除
// =====================================
async function handleSingleDelete(interaction: ButtonInteraction, eventId: string): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) {
        await interaction.editReply({ embeds: [errorEmbed('エラー', 'イベントが見つかりません。')] });
        return;
    }

    await prisma.event.delete({ where: { id: eventId } });
    await interaction.editReply({
        embeds: [successEmbed('削除完了', `**${event.title}** を削除しました。`)],
    });
}

// =====================================
// まとめて削除: SelectMenu表示
// =====================================
async function showBatchDeleteMenu(interaction: ButtonInteraction): Promise<void> {
    const guildId = interaction.guildId;
    if (!guildId) return;

    const events = await prisma.event.findMany({
        where: { guildId, status: { in: ['PLANNING', 'CONFIRMED'] } },
        orderBy: { createdAt: 'desc' },
        take: 25,
    });

    if (events.length === 0) {
        await interaction.reply({
            embeds: [infoEmbed('削除対象なし', '削除できるイベントがありません。')],
            ephemeral: true,
        });
        return;
    }

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('event_delete_select')
        .setPlaceholder('削除するイベントを選択（複数選択可）')
        .setMinValues(1)
        .setMaxValues(events.length)
        .addOptions(
            events.map((e) => ({
                label: e.title,
                description: e.date ? formatDateJP(e.date) : '日程未定',
                value: e.id,
                emoji: e.status === 'CONFIRMED' ? '✅' : '📝',
            })),
        );

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

    await interaction.reply({
        embeds: [infoEmbed('🗑️ まとめて削除', '削除するイベントを選択してください。')],
        components: [row],
        ephemeral: true,
    });
}

// =====================================
// まとめて削除: 実行
// =====================================
async function handleBatchDeleteConfirm(interaction: StringSelectMenuInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const selectedIds = interaction.values;
    const events = await prisma.event.findMany({ where: { id: { in: selectedIds } } });

    if (events.length === 0) {
        await interaction.editReply({ embeds: [errorEmbed('エラー', 'イベントが見つかりません。')] });
        return;
    }

    await prisma.event.deleteMany({ where: { id: { in: selectedIds } } });

    const deletedNames = events.map((e) => `• **${e.title}**`).join('\n');
    await interaction.editReply({
        embeds: [successEmbed(`${events.length}件のイベントを削除しました`, deletedNames)],
    });
}

// =====================================
// 空き日: SelectMenu選択
// =====================================
async function handleAvailabilitySelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const key = `${interaction.user.id}:${interaction.guildId}`;
    const isFirst = interaction.customId === 'availability_select_first';

    let selections = availabilitySelections.get(key);
    if (!selections) {
        selections = new Set();
        availabilitySelections.set(key, selections);
    }

    const { year, month } = getNextMonthInfo();
    const monthStr = String(month).padStart(2, '0');

    if (isFirst) {
        for (let d = 1; d <= 15; d++) {
            selections.delete(`${year}-${monthStr}-${String(d).padStart(2, '0')}`);
        }
    } else {
        for (let d = 16; d <= 31; d++) {
            selections.delete(`${year}-${monthStr}-${String(d).padStart(2, '0')}`);
        }
    }

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

// =====================================
// 空き日: 確定
// =====================================
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

    await prisma.guild.upsert({ where: { guildId }, create: { guildId }, update: {} });
    await prisma.user.upsert({
        where: { userId: interaction.user.id },
        create: { userId: interaction.user.id, discordTag: interaction.user.tag },
        update: { discordTag: interaction.user.tag },
    });

    const dateStrings = Array.from(selections).sort();
    const { year, month } = getNextMonthInfo();
    const monthStr = String(month).padStart(2, '0');

    await prisma.availability.deleteMany({
        where: { userId: interaction.user.id, guildId, date: { startsWith: `${year}-${monthStr}` } },
    });

    await prisma.availability.createMany({
        data: dateStrings.map((date) => ({
            userId: interaction.user.id,
            guildId,
            date,
            status: 'AVAILABLE',
        })),
    });

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
