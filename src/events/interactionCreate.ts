/**
 * interactionCreate イベントハンドラ
 *
 * 全インタラクションをルーティングする中枢。
 * 実際の処理は handlers/ 以下に委譲。
 */

import { type Client, Events, type Interaction , MessageFlags } from 'discord.js';
import { commands } from '../commands/index.js';
import { errorEmbed } from '../utils/embeds.js';
import { getT } from '../i18n/index.js';
import { prisma } from '../lib/prisma.js';

import {
    handleAvailabilitySelect,
    handleAvailabilityConfirm,
    handleAvailabilityClear,
} from './handlers/availability.js';
import {
    handleEventSelectDate,
    handleEventJoin,
    handleEventCancel,
    showEventHistory,
    handleEventRecommend,
} from './handlers/event.js';
import {
    showEventManagePanel,
    showEventDetail,
    showEditModal,
    handleEditSubmit,
    handleSingleDelete,
    showBatchDeleteMenu,
    handleBatchDeleteConfirm,
} from './handlers/manage.js';

export function registerInteractionHandler(client: Client): void {
    client.on(Events.InteractionCreate, async (interaction: Interaction) => {
        try {
            // スラッシュコマンド
            if (interaction.isChatInputCommand()) {
                const command = commands.get(interaction.commandName);
                if (!command) return;

                // 専用チャンネル制限チェック（/setup は除外）
                if (interaction.commandName !== 'setup' && interaction.guildId) {
                    const guild = await prisma.guild.findUnique({
                        where: { guildId: interaction.guildId },
                        select: { botChannelId: true },
                    });
                    if (guild?.botChannelId && interaction.channelId !== guild.botChannelId) {
                        const t = await getT(interaction.guildId);
                        await interaction.reply({
                            embeds: [errorEmbed(t.setup.wrongChannelTitle, t.setup.wrongChannel(guild.botChannelId))],
                            flags: MessageFlags.Ephemeral,
                        });
                        return;
                    }
                }

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

            // Modal 送信
            if (interaction.isModalSubmit()) {
                if (interaction.customId.startsWith('event_edit_modal:')) {
                    await handleEditSubmit(interaction);
                }
                return;
            }

            // ボタン
            if (interaction.isButton()) {
                const id = interaction.customId;

                if (id === 'availability_confirm') { await handleAvailabilityConfirm(interaction); return; }
                if (id === 'availability_clear') { await handleAvailabilityClear(interaction); return; }
                if (id === 'event_history') { await showEventHistory(interaction); return; }
                if (id === 'event_recommend') { await handleEventRecommend(interaction); return; }
                if (id === 'event_batch_delete') { await showBatchDeleteMenu(interaction); return; }

                if (id.startsWith('event_manage_info:')) { await showEventDetail(interaction, id.split(':')[1]); return; }
                if (id.startsWith('event_manage_edit:')) { await showEditModal(interaction, id.split(':')[1]); return; }
                if (id.startsWith('event_manage_delete:')) { await handleSingleDelete(interaction, id.split(':')[1]); return; }
                if (id.startsWith('event_join:')) { await handleEventJoin(interaction, id.split(':')[1]); return; }
                if (id.startsWith('event_cancel:')) { await handleEventCancel(interaction, id.split(':')[1]); return; }

                return;
            }

            // SelectMenu
            if (interaction.isStringSelectMenu()) {
                const id = interaction.customId;

                if (id === 'availability_select_first' || id === 'availability_select_second') {
                    await handleAvailabilitySelect(interaction); return;
                }
                if (id === 'event_manage_select') {
                    await showEventManagePanel(interaction, interaction.values[0]); return;
                }
                if (id === 'event_delete_select') {
                    await handleBatchDeleteConfirm(interaction); return;
                }
                if (id.startsWith('event_select_date:')) {
                    await handleEventSelectDate(interaction, id.split(':')[1]); return;
                }

                return;
            }
        } catch (error) {
            console.error('❌ インタラクション処理エラー:', error);
            const t = await getT(interaction.isRepliable() && (interaction as any).guildId ? (interaction as any).guildId : null);
            const reply = { embeds: [errorEmbed(t.common.errorTitle, t.common.processing)], flags: MessageFlags.Ephemeral as const };
            if (interaction.isRepliable()) {
                if ((interaction as any).deferred || (interaction as any).replied) {
                    await (interaction as any).followUp(reply);
                } else {
                    await interaction.reply(reply);
                }
            }
        }
    });
}
