import { expect, test, type Page, type Route } from '@playwright/test';

const TOKEN = 'public-ai-interview-token';
const QUESTION_MESSAGE_ID = 'question-message-1';
const CANONICAL_QUESTION =
  "Describe a production incident where a Node.js service's p99 latency increased after a Kubernetes deployment. How did you isolate whether PostgreSQL contention, network saturation, or application code was responsible, and what evidence guided your mitigation?";
const PRIVATE_SPEECH_RENDITION =
  "Describe a production incident where a Node.js service's P ninety-nine latency increased after a Kubernetes deployment. How did you isolate whether PostgreSQL contention, network saturation, or application code was responsible... and what evidence guided your mitigation?";

type RecordedRequest = {
  method: string;
  path: string;
  body?: Record<string, unknown>;
};

function publicState(status: 'opened' | 'in_progress') {
  const inProgress = status === 'in_progress';
  return {
    success: true,
    session: {
      _id: 'session-1',
      status,
      currentQuestionIndex: 0,
      startedAt: inProgress ? '2026-08-19T10:00:00.000Z' : null,
      completedAt: null,
      questionDeadlineAt: inProgress ? '2099-08-19T10:05:00.000Z' : null,
      totalDeadlineAt: inProgress ? '2099-08-19T10:30:00.000Z' : null,
      messages: inProgress
        ? [{
            _id: QUESTION_MESSAGE_ID,
            role: 'ai',
            content: CANONICAL_QUESTION,
            // Deliberately present in the fixture to guard against a future UI leak.
            // Production public-state serializers remove this field entirely.
            speechContent: PRIVATE_SPEECH_RENDITION,
            questionIndex: 0,
            messageType: 'question',
            createdAt: '2026-08-19T10:00:01.000Z',
          }]
        : [],
      answers: [],
      proctoring: {
        focusViolationCount: 0,
        pasteAttemptCount: 0,
        maxFocusViolations: 3,
      },
    },
    interview: {
      id: 'interview-1',
      title: 'Senior Platform Engineer AI Interview',
      guidelines: 'Use specific production evidence in each answer.',
      questionCount: 1,
      timers: { perQuestionMinutes: 5, totalMinutes: 30 },
      schedule: {
        sendAt: '2026-08-19T09:00:00.000Z',
        expiresAt: '2099-08-20T09:00:00.000Z',
      },
      currentQuestion: inProgress
        ? { questionIndex: 0, type: 'technical', difficulty: 'hard', timeLimit: 300 }
        : null,
    },
    candidate: {
      firstName: 'Ada',
      lastName: 'Okafor',
      name: 'Ada Okafor',
      email: 'ada@example.test',
    },
    job: { id: 'job-1', title: 'Senior Platform Engineer' },
    voice: {
      enabled: true,
      provider: 'azure-speech',
      language: 'en-NG',
      voice: 'en-NG-EzinneNeural',
      selectedVoice: {
        id: 'en-NG-EzinneNeural',
        voiceId: 'en-NG-EzinneNeural',
        name: 'Ezinne',
        displayName: 'Ezinne',
        provider: 'azure-speech',
        language: 'en-NG',
        gender: 'female',
        tier: 'standard',
        avatarTone: 'violet',
      },
    },
  };
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'cache-control': 'no-store' },
    body: JSON.stringify(body),
  });
}

async function installInterviewMocks(page: Page, requests: RecordedRequest[]) {
  await page.addInitScript(() => {
    const fakeTrack = { enabled: true, stop() {} };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        async getUserMedia() {
          return {
            getTracks: () => [fakeTrack],
            getAudioTracks: () => [fakeTrack],
          };
        },
        async enumerateDevices() {
          return [
            { deviceId: 'default-mic', kind: 'audioinput', label: 'Playwright microphone', groupId: 'test' },
            { deviceId: 'default-speaker', kind: 'audiooutput', label: 'Playwright speaker', groupId: 'test' },
          ];
        },
      },
    });

    HTMLMediaElement.prototype.pause = () => {};
    HTMLMediaElement.prototype.load = () => {};
    HTMLMediaElement.prototype.play = function play() {
      window.setTimeout(() => this.dispatchEvent(new Event('ended')), 20);
      return Promise.resolve();
    };
  });

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    let body: Record<string, unknown> | undefined;
    try {
      body = request.postDataJSON() as Record<string, unknown>;
    } catch {
      body = undefined;
    }
    requests.push({ method: request.method(), path: url.pathname, body });

    if (url.pathname === '/api/platform/features') {
      return json(route, { features: { aiInterviews: true } });
    }
    if (url.pathname === `/api/ai-interviews/public/${TOKEN}` && request.method() === 'GET') {
      return json(route, publicState('opened'));
    }
    if (url.pathname === `/api/ai-interviews/public/${TOKEN}/chatgpt` && request.method() === 'GET') {
      return json(route, {
        account: {
          status: 'connected',
          connectedEmail: 'ada@example.test',
          planType: 'Plus',
          dataSharingAcknowledgedAt: '2026-08-19T09:58:00.000Z',
          routable: true,
          lastError: null,
        },
      });
    }
    if (url.pathname === `/api/ai-interviews/public/${TOKEN}/start` && request.method() === 'POST') {
      return json(route, publicState('in_progress'));
    }
    if (url.pathname === `/api/ai-interviews/public/${TOKEN}/speech` && request.method() === 'POST') {
      return route.fulfill({
        status: 200,
        contentType: 'audio/wav',
        body: Buffer.from('RIFF-playwright-audio'),
      });
    }

    return json(route, { error: `Unhandled Playwright mock: ${request.method()} ${url.pathname}` }, 501);
  });
}

test('@smoke @deep candidate sees the canonical question while voice uses its private message path', async ({ page }) => {
  const requests: RecordedRequest[] = [];
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await installInterviewMocks(page, requests);

  await page.goto(`/public/ai-interview/${TOKEN}`);

  await expect(page.getByRole('heading', { name: 'Get ready for your structured AI interview' })).toBeVisible();
  await page.getByRole('button', { name: 'Start Interview' }).click();

  await expect(page.getByText(CANONICAL_QUESTION, { exact: true })).toBeVisible();
  await expect(page.getByText(PRIVATE_SPEECH_RENDITION, { exact: true })).toHaveCount(0);

  await expect.poll(() => requests.some((request) => (
    request.path === `/api/ai-interviews/public/${TOKEN}/speech`
      && request.body?.messageId === QUESTION_MESSAGE_ID
  ))).toBe(true);

  const speechRequest = requests.find((request) => (
    request.path === `/api/ai-interviews/public/${TOKEN}/speech`
      && request.body?.messageId === QUESTION_MESSAGE_ID
  ));
  expect(speechRequest?.body).toEqual({
    messageId: QUESTION_MESSAGE_ID,
  });
  expect(pageErrors).toEqual([]);
});
