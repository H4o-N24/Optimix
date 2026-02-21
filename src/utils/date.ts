/**
 * 日付操作ユーティリティ
 */

/** 翌月の年・月・日数を返す */
export function getNextMonthInfo(): { year: number; month: number; daysInMonth: number } {
    const now = new Date();
    const year = now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear();
    const month = (now.getMonth() + 1) % 12 + 1; // 1-indexed
    const daysInMonth = new Date(year, month, 0).getDate();
    return { year, month, daysInMonth };
}

/** YYYY-MM-DD を日本語の曜日付き文字列にフォーマット */
export function formatDateJP(dateStr: string): string {
    const days = ['日', '月', '火', '水', '木', '金', '土'];
    const date = new Date(dateStr + 'T00:00:00');
    const dayOfWeek = days[date.getDay()];
    const [y, m, d] = dateStr.split('-');
    return `${y}年${Number(m)}月${Number(d)}日(${dayOfWeek})`;
}
