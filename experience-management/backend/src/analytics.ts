import type { Question, ResponseRecord, Survey } from './types.js';

function asNumber(value: unknown): number | null {
  if (Array.isArray(value)) return value.length ? asNumber(value[0]) : null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function distributionValues(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.entries(value as Record<string, unknown>).map(([label, item]) => `${label}: ${String(item)}`);
  return [value];
}

function pearson(left: number[], right: number[]) {
  if (left.length < 3 || left.length !== right.length) return null;
  const leftMean = average(left)!;
  const rightMean = average(right)!;
  let numerator = 0;
  let leftSquare = 0;
  let rightSquare = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] - leftMean;
    const b = right[index] - rightMean;
    numerator += a * b;
    leftSquare += a * a;
    rightSquare += b * b;
  }
  const denominator = Math.sqrt(leftSquare * rightSquare);
  return denominator ? numerator / denominator : null;
}

export function computeAnalytics(survey: Survey, responses: ResponseRecord[]) {
  const questions = survey.questions || [];
  const completed = responses.filter((response) => response.status === 'completed');
  const npsQuestion = questions.find((question) => question.type === 'nps');
  const csatQuestion = questions.find((question) => question.type === 'csat');
  const cesQuestion = questions.find((question) => question.type === 'ces');
  const npsValues = npsQuestion ? completed.map((response) => asNumber(response.answers[npsQuestion.id])).filter((value): value is number => value !== null) : [];
  const promoters = npsValues.filter((value) => value >= 9).length;
  const detractors = npsValues.filter((value) => value <= 6).length;
  const nps = npsValues.length ? Math.round(((promoters - detractors) / npsValues.length) * 100) : null;
  const ratingValues = (question: Question | undefined) => question
    ? completed.map((response) => asNumber(response.answers[question.id])).filter((value): value is number => value !== null)
    : [];
  const csatValues = ratingValues(csatQuestion);
  const cesValues = ratingValues(cesQuestion);
  const trendMap = new Map<string, { responses: number; score: number[] }>();
  for (const response of completed) {
    const day = String(response.completedAt || response.startedAt).slice(0, 10);
    const bucket = trendMap.get(day) || { responses: 0, score: [] };
    bucket.responses += 1;
    const score = asNumber(response.answers[(npsQuestion || csatQuestion || cesQuestion)?.id || '']);
    if (score !== null) bucket.score.push(score);
    trendMap.set(day, bucket);
  }
  const questionSummaries = questions.filter((question) => question.type !== 'statement').map((question) => {
    const values = completed.map((response) => response.answers[question.id]).filter((value) => value !== undefined && value !== null && value !== '');
    const counts = new Map<string, number>();
    values.flatMap(distributionValues).forEach((value) => counts.set(String(value), (counts.get(String(value)) || 0) + 1));
    const numeric = values.map(asNumber).filter((value): value is number => value !== null);
    return {
      questionId: question.id, title: question.title, type: question.type, answered: values.length,
      responseRate: completed.length ? Math.round((values.length / completed.length) * 1000) / 10 : 0,
      average: average(numeric), distribution: [...counts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count)
    };
  });
  const outcomeQuestion = npsQuestion || csatQuestion || cesQuestion || questions.find((question) => ['rating', 'graphical_rating', 'slider', 'number'].includes(question.type));
  const drivers = outcomeQuestion ? questions.filter((question) => question.id !== outcomeQuestion.id && ['rating', 'graphical_rating', 'slider', 'number', 'csat', 'ces', 'nps'].includes(question.type)).map((question) => {
    const pairs = completed.map((response) => [asNumber(response.answers[question.id]), asNumber(response.answers[outcomeQuestion.id])])
      .filter((pair): pair is [number, number] => pair[0] !== null && pair[1] !== null);
    const correlation = pearson(pairs.map((pair) => pair[0]), pairs.map((pair) => pair[1]));
    return { questionId: question.id, title: question.title, correlation, sampleSize: pairs.length };
  }).filter((driver) => driver.correlation !== null).sort((a, b) => Math.abs(b.correlation!) - Math.abs(a.correlation!)) : [];
  const sentiment = { very_negative: 0, negative: 0, neutral: 0, positive: 0, very_positive: 0 } as Record<string, number>;
  const themes = new Map<string, number>();
  for (const response of completed) {
    const analysis = response.aiAnalysis as any;
    if (analysis?.sentiment && sentiment[analysis.sentiment] !== undefined) sentiment[analysis.sentiment] += 1;
    for (const topic of analysis?.topics || []) themes.set(topic.name, (themes.get(topic.name) || 0) + 1);
  }
  return {
    totals: {
      responses: responses.length, completed: completed.length, partial: responses.length - completed.length,
      completionRate: responses.length ? Math.round((completed.length / responses.length) * 1000) / 10 : 0,
      averageDurationSeconds: average(completed.map((response) => response.durationSeconds || 0)),
      analyzedResponses: completed.filter((response) => response.aiAnalysis).length
    },
    metrics: {
      nps, promoters, passives: npsValues.filter((value) => value === 7 || value === 8).length, detractors,
      csat: average(csatValues), ces: average(cesValues)
    },
    trend: [...trendMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, responses: value.responses, score: average(value.score) })),
    questions: questionSummaries,
    drivers,
    sentiment,
    themes: [...themes.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 12),
    dropoff: questions.map((question, index) => ({
      questionId: question.id, title: question.title, position: index + 1,
      reached: responses.filter((response) => response.answers[question.id] !== undefined).length
    }))
  };
}
