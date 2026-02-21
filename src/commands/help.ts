/**
 * /help コマンド - ヘルプ表示
 */

import {
    SlashCommandBuilder,
    type ChatInputCommandInteraction,
    EmbedBuilder,
} from 'discord.js';

/** Blurple (ブランドカラー) */
const BRAND_COLOR = 0x5865F2 as const;

export const data = new SlashCommandBuilder()
    .setName('help')
    .setDescription('Knotの使い方を表示します');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const embed = new EmbedBuilder()
        .setColor(BRAND_COLOR)
        .setTitle('📖 Knot - ヘルプ')
        .setDescription(
            'Knotは、メンバーの空きスケジュールから**最適な日程を自動提案**するDiscord Botです。',
        )
        .addFields(
            {
                name: '📅 `/availability`',
                value: '翌月の空き日をカレンダー選択で登録・修正します。\n再実行で既存の登録を確認・上書きできます。',
                inline: false,
            },
            {
                name: '🎉 `/event create`',
                value: [
                    'イベントを作成し、最適日を自動抽出します。',
                    '• `title` - イベント名（必須）',
                    '• `min` - 最低参加人数',
                    '• `max` - 定員（上限）',
                    '• `required1〜3` - 必須メンバー',
                    '• `dayfilter` - 平日のみ / 週末のみ',
                ].join('\n'),
                inline: false,
            },
            {
                name: '📋 `/event list`',
                value: '現在のイベント一覧を表示します。',
                inline: false,
            },
            {
                name: '⚙️ `/event manage`',
                value: [
                    'イベントの管理パネルを表示します。',
                    '選択したイベントに対して以下の操作が可能:',
                    '• 📋 **参加** - 詳細表示＆参加ボタン',
                    '• ✏️ **編集** - イベント名・人数を変更',
                    '• 🗑️ **削除** - イベントを削除',
                    '• 🗑️ **まとめて削除** - 複数イベントを一括削除',
                ].join('\n'),
                inline: false,
            },
            {
                name: '🤖 自動機能',
                value: [
                    '• 月末に翌月の空き日登録リマインダーを自動送信',
                    '• 月末に終了したイベントを自動クリーンアップ',
                ].join('\n'),
                inline: false,
            },
        )
        .setFooter({ text: 'Knot v1.1.0 | Discord日程調整Bot' });

    await interaction.reply({ embeds: [embed], ephemeral: true });
}
