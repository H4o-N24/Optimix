/**
 * Prisma クライアントのシングルトン
 *
 * アプリ全体で1つのインスタンスを共有することで
 * DB接続数の無駄な増加を防ぐ。
 */
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();
