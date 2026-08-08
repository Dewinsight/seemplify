const { isConfigured, sendMail } = require('../services/mailClient');

const environment = {
    NODE_ENV: 'production',
    MAIL_API_BASE_URL: 'https://mail.example.test',
    MAIL_API_TOKEN: 'key.secret',
    MAIL_FROM_EMAIL: 'no-reply@example.test',
    MAIL_FROM_NAME: 'Time & Attendance',
};

afterEach(() => jest.restoreAllMocks());

test('uses the same authenticated first-party mail contract as Recruiter', async () => {
    global.fetch = jest.fn(async () => ({
        status: 202,
        ok: true,
        text: async () => JSON.stringify({ status: 'accepted', messageId: 'message-1' }),
    }));

    const result = await sendMail({
        to: 'employee@example.test',
        subject: 'Clock reminder',
        text: 'Remember to clock in',
        idempotencyKey: 'attendance:org:user:2026-08-08:clock_in',
    }, environment);

    const [url, request] = global.fetch.mock.calls[0];
    const body = JSON.parse(request.body);
    expect(url).toBe('https://mail.example.test/v1/messages');
    expect(request.headers.Authorization).toBe('Bearer key.secret');
    expect(request.headers['Idempotency-Key']).toBe('attendance:org:user:2026-08-08:clock_in');
    expect(body).toMatchObject({ from: 'no-reply@example.test', fromName: 'Time & Attendance', to: ['employee@example.test'] });
    expect(result).toMatchObject({ status: 'accepted', messageId: 'message-1' });
});

test('fails closed in production when the central mail service is not configured', () => {
    expect(isConfigured({ NODE_ENV: 'production', MAIL_API_TOKEN: 'token', MAIL_FROM_EMAIL: 'from@example.test' })).toBe(false);
    expect(isConfigured({ NODE_ENV: 'production', MAIL_API_BASE_URL: 'https://mail.example.test', MAIL_API_TOKEN: 'token' })).toBe(false);
});
