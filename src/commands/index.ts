/**
 * コマンドローダー
 * commands/ ディレクトリ内のすべてのコマンドを自動読み込み
 */

import {
    Collection,
    type ChatInputCommandInteraction,
    type SlashCommandBuilder,
} from 'discord.js';

import * as availability from './availability.js';
import * as event from './event.js';
import * as help from './help.js';
import * as setup from './setup.js';

export interface Command {
    data: SlashCommandBuilder;
    execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

const commands = new Collection<string, Command>();

// コマンドを登録
const modules = [availability, event, help, setup] as Command[];
for (const mod of modules) {
    commands.set(mod.data.name, mod);
}

export { commands };

/** スラッシュコマンドのJSONデータ（登録用） */
export function getCommandsJSON() {
    return modules.map((mod) => mod.data.toJSON());
}
