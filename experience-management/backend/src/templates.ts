import type { Question, Survey } from './types.js';

type Template = {
  id: string;
  name: string;
  description: string;
  purpose: Survey['purpose'];
  primaryMetric: Survey['primaryMetric'];
  audience: string;
  questions: Partial<Question>[];
};

export const templates: Template[] = [
  {
    id: 'customer-nps', name: 'Customer relationship NPS', purpose: 'customer_experience', primaryMetric: 'nps',
    audience: 'Active customers', description: 'Measure loyalty, understand the reason behind the score, and identify recovery opportunities.',
    questions: [
      { type: 'nps', title: 'How likely are you to recommend us to a friend or colleague?', description: '0 means not at all likely and 10 means extremely likely.', required: true },
      { type: 'long_text', title: 'What is the main reason for your score?', description: '', required: true },
      { type: 'multiple_choice', title: 'Which parts of your experience mattered most?', description: '', required: false, options: ['Product quality', 'Ease of use', 'Customer support', 'Price and value', 'Delivery or setup'] },
      { type: 'long_text', title: 'What is the one thing we should improve next?', description: '', required: false }
    ]
  },
  {
    id: 'transactional-csat', name: 'Support interaction CSAT', purpose: 'customer_experience', primaryMetric: 'csat',
    audience: 'Customers after a support interaction', description: 'Assess satisfaction, effort, resolution, and agent experience after support.',
    questions: [
      { type: 'csat', title: 'How satisfied are you with the support you received?', description: '', required: true, settings: { min: 1, max: 5 } },
      { type: 'ces', title: 'How easy was it to get your issue resolved?', description: '', required: true, settings: { min: 1, max: 7 } },
      { type: 'single_choice', title: 'Was your issue resolved?', description: '', required: true, options: ['Yes, completely', 'Partly', 'No'] },
      { type: 'long_text', title: 'Tell us what worked well or what we could do better.', description: '', required: false }
    ]
  },
  {
    id: 'employee-pulse', name: 'Employee pulse', purpose: 'employee_experience', primaryMetric: 'nps',
    audience: 'Employees', description: 'A short recurring pulse covering advocacy, clarity, enablement, belonging, and open feedback.',
    questions: [
      { type: 'nps', title: 'How likely are you to recommend this organisation as a place to work?', description: '', required: true },
      { type: 'rating', title: 'I understand what is expected of me at work.', description: '', required: true, settings: { min: 1, max: 5 } },
      { type: 'rating', title: 'I have the tools and support I need to do my best work.', description: '', required: true, settings: { min: 1, max: 5 } },
      { type: 'rating', title: 'I feel that I belong in my team.', description: '', required: true, settings: { min: 1, max: 5 } },
      { type: 'long_text', title: 'What should we keep doing?', description: '', required: false },
      { type: 'long_text', title: 'What should we change?', description: '', required: false }
    ]
  },
  {
    id: 'concept-test', name: 'Product concept test', purpose: 'market_research', primaryMetric: 'custom',
    audience: 'Target-market participants', description: 'Evaluate appeal, clarity, uniqueness, intent, objections, and pricing expectations.',
    questions: [
      { type: 'statement', title: 'Please review the product concept before answering the following questions.', description: '', required: false },
      { type: 'rating', title: 'How appealing is this concept?', description: '', required: true, settings: { min: 1, max: 7 } },
      { type: 'rating', title: 'How easy is the concept to understand?', description: '', required: true, settings: { min: 1, max: 7 } },
      { type: 'rating', title: 'How different does it feel from alternatives?', description: '', required: true, settings: { min: 1, max: 7 } },
      { type: 'single_choice', title: 'How likely would you be to try it?', description: '', required: true, options: ['Definitely would', 'Probably would', 'Might or might not', 'Probably would not', 'Definitely would not'] },
      { type: 'long_text', title: 'What is most appealing about the concept?', description: '', required: false },
      { type: 'long_text', title: 'What concerns or questions do you have?', description: '', required: false }
    ]
  },
  {
    id: 'journey-touchpoint', name: 'Journey touchpoint review', purpose: 'customer_experience', primaryMetric: 'ces',
    audience: 'Customers at a selected journey stage', description: 'Measure effort and satisfaction at a journey touchpoint and uncover the strongest improvement driver.',
    questions: [
      { type: 'single_choice', title: 'Which part of your journey are you rating?', description: '', required: true, options: ['Discovery', 'Purchase', 'Onboarding', 'Ongoing use', 'Support', 'Renewal'] },
      { type: 'ces', title: 'How easy was it to complete what you wanted to do?', description: '', required: true, settings: { min: 1, max: 7 } },
      { type: 'csat', title: 'Overall, how satisfied were you with this experience?', description: '', required: true, settings: { min: 1, max: 5 } },
      { type: 'long_text', title: 'Where did you encounter friction?', description: '', required: false },
      { type: 'long_text', title: 'What would have made this experience easier?', description: '', required: false }
    ]
  }
];
