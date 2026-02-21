/**
 * 参加者管理サービス (Participant Service)
 *
 * - 参加登録（定員チェック → 参加 or キャンセル待ち）
 * - キャンセル処理（最古のキャンセル待ちを自動繰り上げ＋通知）
 */

import { prisma } from '../lib/prisma.js';

export interface ParticipantResult {
    success: boolean;
    status: 'CONFIRMED' | 'WAITLISTED' | 'CANCELLED' | 'PROMOTED' | 'ALREADY_JOINED' | 'NOT_FOUND';
    message: string;
    promotedUserId?: string; // 繰り上げされたユーザーID
}

/**
 * イベントに参加する
 * 定員に達している場合はキャンセル待ちに登録
 */
export async function joinEvent(eventId: string, userId: string): Promise<ParticipantResult> {
    // ユーザーが既に参加しているか確認
    const existing = await prisma.eventParticipant.findUnique({
        where: { eventId_userId: { eventId, userId } },
    });

    if (existing) {
        if (existing.status === 'CONFIRMED') {
            return { success: false, status: 'ALREADY_JOINED', message: '既にこのイベントに参加しています。' };
        }
        if (existing.status === 'WAITLISTED') {
            return { success: false, status: 'WAITLISTED', message: '既にキャンセル待ちに登録されています。' };
        }
        // CANCELLED → 再参加
        await prisma.eventParticipant.delete({
            where: { id: existing.id },
        });
    }

    // イベント情報を取得
    const event = await prisma.event.findUnique({
        where: { id: eventId },
        include: {
            participants: {
                where: { status: 'CONFIRMED' },
            },
        },
    });

    if (!event) {
        return { success: false, status: 'NOT_FOUND', message: 'イベントが見つかりません。' };
    }

    // 定員チェック
    const confirmedCount = event.participants.length;
    const isFull = event.maxParticipants != null && confirmedCount >= event.maxParticipants;

    if (isFull) {
        // キャンセル待ちに登録
        await prisma.eventParticipant.create({
            data: {
                eventId,
                userId,
                status: 'WAITLISTED',
            },
        });
        return {
            success: true,
            status: 'WAITLISTED',
            message: `定員に達しているため、キャンセル待ちに登録しました（現在 ${confirmedCount}/${event.maxParticipants} 人）。`,
        };
    }

    // 参加確定
    await prisma.eventParticipant.create({
        data: {
            eventId,
            userId,
            status: 'CONFIRMED',
        },
    });

    return {
        success: true,
        status: 'CONFIRMED',
        message: `イベント「${event.title}」への参加を確定しました！（${confirmedCount + 1}${event.maxParticipants ? `/${event.maxParticipants}` : ''} 人）`,
    };
}

/**
 * イベントをキャンセルする
 * キャンセル待ちがいる場合、最古のユーザーを自動繰り上げ
 */
export async function cancelEvent(eventId: string, userId: string): Promise<ParticipantResult> {
    const participant = await prisma.eventParticipant.findUnique({
        where: { eventId_userId: { eventId, userId } },
    });

    if (!participant) {
        return { success: false, status: 'NOT_FOUND', message: 'このイベントに参加していません。' };
    }

    const wasConfirmed = participant.status === 'CONFIRMED';

    // 参加レコードを削除
    await prisma.eventParticipant.delete({
        where: { id: participant.id },
    });

    // 確定者がキャンセルした場合、キャンセル待ちから繰り上げ
    if (wasConfirmed) {
        const nextWaitlisted = await prisma.eventParticipant.findFirst({
            where: {
                eventId,
                status: 'WAITLISTED',
            },
            orderBy: {
                joinedAt: 'asc', // 最古のキャンセル待ち
            },
        });

        if (nextWaitlisted) {
            await prisma.eventParticipant.update({
                where: { id: nextWaitlisted.id },
                data: { status: 'CONFIRMED' },
            });

            return {
                success: true,
                status: 'PROMOTED',
                message: 'キャンセルしました。キャンセル待ちのメンバーを自動繰り上げしました。',
                promotedUserId: nextWaitlisted.userId,
            };
        }
    }

    return {
        success: true,
        status: 'CANCELLED',
        message: 'イベントへの参加をキャンセルしました。',
    };
}

