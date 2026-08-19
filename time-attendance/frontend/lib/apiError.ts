export const API_ERROR_EVENT = 'seemplify:api-error';

const handledKey = '__seemplifyUserVisible';

type ApiErrorOptions = {
    markHandled?: boolean;
};

function readableCode(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function formatDate(value: unknown) {
    if (typeof value !== 'string' && !(value instanceof Date)) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
    }).format(date);
}

export function getApiErrorMessage(reason: any, fallback: string, options: ApiErrorOptions = {}) {
    const payload = reason?.response?.data;
    const backendMessage = typeof payload?.error === 'string' ? payload.error.trim()
        : typeof payload?.message === 'string' ? payload.message.trim()
            : '';
    const message = backendMessage || (typeof reason?.message === 'string' ? reason.message.trim() : '') || fallback;
    const context: string[] = [];
    const code = readableCode(payload?.code);
    const periodEndsAt = formatDate(payload?.periodEndsAt);
    const detailsReason = typeof payload?.details?.reason === 'string' ? payload.details.reason.trim() : '';
    const incompleteEntries = Number(payload?.incompleteEntries);

    if (detailsReason && detailsReason !== message) context.push(detailsReason);
    if (periodEndsAt) context.push(`Period ends ${periodEndsAt}`);
    if (Number.isFinite(incompleteEntries) && incompleteEntries > 0) {
        context.push(`${incompleteEntries} incomplete ${incompleteEntries === 1 ? 'entry' : 'entries'}`);
    }
    if (typeof payload?.currentStatus === 'string' && payload.currentStatus.trim()) {
        context.push(`Current status: ${payload.currentStatus.replaceAll('_', ' ')}`);
    }
    if (code) context.push(`Code: ${code}`);
    if (options.markHandled !== false && reason && typeof reason === 'object') reason[handledKey] = true;

    return [message, ...context].join(' · ');
}

export function isApiErrorHandled(reason: any) {
    return Boolean(reason?.[handledKey]);
}
