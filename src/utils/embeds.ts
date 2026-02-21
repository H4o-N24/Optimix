import {
    EmbedBuilder,
    type ColorResolvable,
} from 'discord.js';

/** Knotブランドカラー */
const BRAND_COLORS = {
    primary: 0x5865F2 as ColorResolvable,   // Discord Blurple
    success: 0x57F287 as ColorResolvable,
    warning: 0xFEE75C as ColorResolvable,
    error: 0xED4245 as ColorResolvable,
    info: 0x5BC0EB as ColorResolvable,
};

/** 成功メッセージ用 Embed */
export function successEmbed(title: string, description: string): EmbedBuilder {
    return new EmbedBuilder()
        .setColor(BRAND_COLORS.success)
        .setTitle(`✅ ${title}`)
        .setDescription(description)
        .setTimestamp();
}

/** エラーメッセージ用 Embed */
export function errorEmbed(title: string, description: string): EmbedBuilder {
    return new EmbedBuilder()
        .setColor(BRAND_COLORS.error)
        .setTitle(`❌ ${title}`)
        .setDescription(description)
        .setTimestamp();
}

/** 情報メッセージ用 Embed */
export function infoEmbed(title: string, description: string): EmbedBuilder {
    return new EmbedBuilder()
        .setColor(BRAND_COLORS.info)
        .setTitle(`📋 ${title}`)
        .setDescription(description)
        .setTimestamp();
}

/** イベント表示用 Embed */
export function eventEmbed(
    title: string,
    description: string,
    fields: { name: string; value: string; inline?: boolean }[],
): EmbedBuilder {
    return new EmbedBuilder()
        .setColor(BRAND_COLORS.primary)
        .setTitle(`📅 ${title}`)
        .setDescription(description)
        .addFields(fields)
        .setTimestamp();
}

/** ランキング候補日 Embed */
export function candidateEmbed(
    candidates: { date: string; count: number; members: string[]; tags?: string[] }[],
    title = '🏆 おすすめ候補日',
): EmbedBuilder {
    const embed = new EmbedBuilder()
        .setColor(BRAND_COLORS.primary)
        .setTitle(title)
        .setDescription('✨ 空き日データをもとに最適な日程をランキング形式で提案します。\nSelectMenuから希望日を選んで確定してください。')
        .setTimestamp();

    candidates.forEach((c, i) => {
        const medal = ['🥇', '🥈', '🥉'][i] ?? `**${i + 1}.**`;
        const tagLine = c.tags && c.tags.length > 0 ? `\n${c.tags.join('  ')}` : '';
        embed.addFields({
            name: `${medal} ${c.date}`,
            value: `👥 **${c.count}人**参加可能: ${c.members.join(', ')}${tagLine}`,
            inline: false,
        });
    });

    return embed;
}
