import dotenv from 'dotenv'
import mongoose from 'mongoose'
import { Account } from '../src/models/Account.js'
import { SimpleLmsCourse } from '../src/models/SimpleLmsCourse.js'

dotenv.config()

const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI
if (!mongoUri) {
  throw new Error('Missing MONGODB_URI / MONGO_URI')
}

const creatorEmail = String(process.env.SEED_CREATOR_EMAIL || 'michael.egbo@aiinnigeria.com')
  .trim()
  .toLowerCase()

const slugify = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 80)

const createLesson = ({ title, description, videoUrl, content, durationMinutes, resources = [], quizQuestions = [] }) => ({
  key: slugify(title),
  title,
  description,
  videoUrl,
  content,
  durationMinutes,
  resources,
  quizQuestions
})

const createChapter = ({ title, description, lessons }) => ({
  key: slugify(title),
  title,
  description,
  lessons
})

const makeQuiz = (prompt, choices, correctIndex, explanation = '') => ({
  prompt,
  explanation,
  choices: choices.map((text, index) => ({
    text,
    isCorrect: index === correctIndex
  }))
})

const courseSeed = [
  {
    title: 'Workplace Communication Mastery',
    summary: 'Build confident communication habits for meetings, feedback, and team alignment.',
    description: 'A practical communication course focused on clarity, listening, and professional influence in modern workplaces.',
    category: 'Professional Skills',
    level: 'beginner',
    tags: ['communication', 'workplace', 'feedback', 'collaboration'],
    banner: {
      // Source: Pexels
      url: 'https://images.pexels.com/photos/5256685/pexels-photo-5256685.jpeg?auto=compress&cs=tinysrgb&w=1600',
      publicId: ''
    },
    pricing: {
      paymentMode: 'free',
      amount: 0,
      currency: 'NGN'
    },
    chapters: [
      createChapter({
        title: 'Communication Foundations',
        description: 'Understand the habits and structures behind clear communication.',
        lessons: [
          createLesson({
            title: 'How Communication Drives Workplace Success',
            description: 'Explore why communication skill directly impacts performance and leadership.',
            videoUrl: 'https://www.youtube.com/watch?v=knUEdy-kOIQ',
            durationMinutes: 18,
            content: 'In this lesson, learners identify communication blockers and define a repeatable framework for clear messaging.',
            resources: [
              { label: 'Meeting Notes Template', url: 'https://www.notion.so/templates', type: 'link' }
            ],
            quizQuestions: [
              makeQuiz(
                'What is the best first step before any important work conversation?',
                ['Start speaking immediately', 'Clarify your objective and desired outcome', 'Avoid questions', 'Use only email'],
                1,
                'Clarifying the outcome improves relevance and reduces confusion.'
              )
            ]
          }),
          createLesson({
            title: 'Speaking with Clarity in High-Stakes Conversations',
            description: 'Learn practical methods for concise, impactful speaking.',
            videoUrl: 'https://www.youtube.com/watch?v=7zDmD1Ctqe4',
            durationMinutes: 14,
            content: 'This lesson breaks down message structure: context, point, action. Learners practice concise updates and requests.',
            quizQuestions: [
              makeQuiz(
                'Which structure improves clarity the most?',
                ['Context -> Point -> Action', 'Action -> Context -> Joke', 'Point only', 'Data dump'],
                0
              )
            ]
          })
        ]
      }),
      createChapter({
        title: 'Listening and Feedback',
        description: 'Strengthen collaboration by improving active listening and feedback loops.',
        lessons: [
          createLesson({
            title: 'Active Listening for Team Leads',
            description: 'How to listen for intent, risk, and hidden constraints.',
            videoUrl: 'https://www.youtube.com/watch?v=knUEdy-kOIQ',
            durationMinutes: 12,
            content: 'Active listening includes clarifying questions, paraphrasing, and agreement checks.',
            quizQuestions: [
              makeQuiz(
                'What is a sign of active listening?',
                ['Interrupting quickly', 'Paraphrasing what you heard', 'Changing the topic', 'Avoiding follow-up questions'],
                1
              )
            ]
          }),
          createLesson({
            title: 'Giving Constructive Feedback Without Friction',
            description: 'Deliver feedback with empathy while preserving accountability.',
            videoUrl: 'https://www.youtube.com/watch?v=7zDmD1Ctqe4',
            durationMinutes: 16,
            content: 'Use behavior-impact-next-step format. Focus on observable facts, not assumptions.',
            quizQuestions: [
              makeQuiz(
                'Feedback should focus on:',
                ['Personality traits', 'Observable behaviors and impact', 'Rumors', 'Public criticism'],
                1
              )
            ]
          })
        ]
      }),
      createChapter({
        title: 'Alignment and Conflict Navigation',
        description: 'Resolve misalignment and keep teams moving.',
        lessons: [
          createLesson({
            title: 'Running Alignment Conversations',
            description: 'Create shared understanding on priorities and ownership.',
            videoUrl: 'https://www.youtube.com/watch?v=knUEdy-kOIQ',
            durationMinutes: 15,
            content: 'Alignment meetings should end with clear owners, deadlines, and risk flags.',
            quizQuestions: [
              makeQuiz(
                'A good alignment meeting ends with:',
                ['More confusion', 'Clear owners and deadlines', 'No decisions', 'Only discussion'],
                1
              )
            ]
          }),
          createLesson({
            title: 'De-escalating Workplace Conflict',
            description: 'Use framing, empathy, and issue isolation to resolve tension.',
            videoUrl: 'https://www.youtube.com/watch?v=7zDmD1Ctqe4',
            durationMinutes: 13,
            content: 'Separate people from problems. Confirm shared goals before debating options.',
            quizQuestions: [
              makeQuiz(
                'When de-escalating conflict, do this first:',
                ['Assign blame', 'Confirm shared goals', 'Escalate immediately', 'Ignore concerns'],
                1
              )
            ]
          })
        ]
      })
    ]
  },
  {
    title: 'Agile Project Delivery Essentials',
    summary: 'Plan, execute, and improve project delivery with Agile principles and practical rituals.',
    description: 'This course gives team leads and managers a hands-on Agile delivery workflow from backlog planning to sprint retrospectives.',
    category: 'Project Management',
    level: 'intermediate',
    tags: ['agile', 'project management', 'delivery', 'scrum'],
    banner: {
      // Source: Pexels
      url: 'https://images.pexels.com/photos/7698815/pexels-photo-7698815.jpeg?auto=compress&cs=tinysrgb&w=1600',
      publicId: ''
    },
    pricing: {
      paymentMode: 'paid',
      amount: 850000,
      currency: 'NGN'
    },
    chapters: [
      createChapter({
        title: 'Agile Mindset and Roles',
        description: 'Understand Agile principles and team role responsibilities.',
        lessons: [
          createLesson({
            title: 'Agile in Practice for Modern Teams',
            description: 'Translate Agile theory into daily work behaviors.',
            videoUrl: 'https://www.youtube.com/watch?v=km7n3DI5IWk',
            durationMinutes: 20,
            content: 'Learners map Agile values to real delivery workflows and identify anti-patterns in execution.',
            quizQuestions: [
              makeQuiz(
                'Agile primarily optimizes for:',
                ['Rigid long-term plans', 'Adaptability and incremental value delivery', 'No documentation ever', 'Micromanagement'],
                1
              )
            ]
          }),
          createLesson({
            title: 'Project Roles, Ownership, and Escalation Paths',
            description: 'Define who decides what and when to escalate risks.',
            videoUrl: 'https://www.youtube.com/watch?v=rBSCvPYGnTc',
            durationMinutes: 17,
            content: 'Clear role boundaries reduce handoff confusion and delivery delays.',
            quizQuestions: [
              makeQuiz(
                'Role clarity helps teams by:',
                ['Adding unnecessary complexity', 'Reducing confusion and bottlenecks', 'Eliminating accountability', 'Avoiding planning'],
                1
              )
            ]
          })
        ]
      }),
      createChapter({
        title: 'Backlog and Sprint Planning',
        description: 'Turn goals into prioritized, executable sprint work.',
        lessons: [
          createLesson({
            title: 'Backlog Prioritization and Scope Control',
            description: 'Use impact-effort and risk scoring for better prioritization.',
            videoUrl: 'https://www.youtube.com/watch?v=km7n3DI5IWk',
            durationMinutes: 18,
            content: 'Build a backlog strategy that protects the sprint goal and delivery quality.',
            quizQuestions: [
              makeQuiz(
                'What should guide backlog priority first?',
                ['Loudest stakeholder', 'Business impact and delivery risk', 'Oldest ticket only', 'Random selection'],
                1
              )
            ]
          }),
          createLesson({
            title: 'Sprint Planning Workflow',
            description: 'Create realistic sprint commitments with measurable outcomes.',
            videoUrl: 'https://www.youtube.com/watch?v=rBSCvPYGnTc',
            durationMinutes: 16,
            content: 'Teams estimate effort, confirm dependencies, and define done criteria before sprint start.',
            quizQuestions: [
              makeQuiz(
                'A sprint plan should include:',
                ['No estimates', 'Done criteria and dependency checks', 'Only roadmap slides', 'Unlimited scope'],
                1
              )
            ]
          })
        ]
      }),
      createChapter({
        title: 'Execution and Continuous Improvement',
        description: 'Run effective standups, demos, and retrospectives.',
        lessons: [
          createLesson({
            title: 'Daily Standups and Delivery Signals',
            description: 'Use standups to unblock work, not to report status theatrics.',
            videoUrl: 'https://www.youtube.com/watch?v=km7n3DI5IWk',
            durationMinutes: 15,
            content: 'Standups should spotlight blockers, risk movement, and support needs.',
            quizQuestions: [
              makeQuiz(
                'The primary purpose of a standup is to:',
                ['Read all tickets aloud', 'Surface blockers and align execution', 'Replace sprint planning', 'Evaluate annual performance'],
                1
              )
            ]
          }),
          createLesson({
            title: 'Retrospectives that Actually Improve Teams',
            description: 'Capture actionable improvements with owners and due dates.',
            videoUrl: 'https://www.youtube.com/watch?v=rBSCvPYGnTc',
            durationMinutes: 14,
            content: 'Strong retrospectives produce 1-3 concrete changes that are tracked in the next sprint.',
            quizQuestions: [
              makeQuiz(
                'A good retrospective action item is:',
                ['Vague and optional', 'Specific, owned, and time-bound', 'Only a complaint', 'Unrelated to delivery'],
                1
              )
            ]
          })
        ]
      })
    ]
  },
  {
    title: 'Excel for Data Analysis Bootcamp',
    summary: 'Use Excel confidently for cleaning, analysis, and reporting workflows.',
    description: 'A practical Excel analytics journey for learners who want to move from raw data to decision-ready dashboards.',
    category: 'Data Analytics',
    level: 'beginner',
    tags: ['excel', 'analytics', 'data', 'reporting'],
    banner: {
      // Source: Pexels
      url: 'https://images.pexels.com/photos/5716016/pexels-photo-5716016.jpeg?auto=compress&cs=tinysrgb&w=1600',
      publicId: ''
    },
    pricing: {
      paymentMode: 'paid',
      amount: 4900,
      currency: 'USD'
    },
    chapters: [
      createChapter({
        title: 'Excel Core Workflow',
        description: 'Build strong spreadsheet fundamentals for analysis.',
        lessons: [
          createLesson({
            title: 'Excel Foundations for Beginners',
            description: 'Navigate the interface, formulas, and formatting basics.',
            videoUrl: 'https://www.youtube.com/watch?v=uGcqA8L3pBY',
            durationMinutes: 24,
            content: 'Learners set up clean spreadsheets, validate values, and structure data tables for analysis.',
            quizQuestions: [
              makeQuiz(
                'Why should raw data be structured as a table?',
                ['Harder analysis', 'Reliable formulas and filtering', 'Less readable', 'To avoid charts'],
                1
              )
            ]
          }),
          createLesson({
            title: 'Preparing Datasets for Analysis',
            description: 'Apply cleaning patterns and column normalization.',
            videoUrl: 'https://www.youtube.com/watch?v=RbG8c-nT3mU',
            durationMinutes: 20,
            content: 'Standardize date formats, remove duplicates, and create analysis-ready columns.',
            quizQuestions: [
              makeQuiz(
                'What is a key data-cleaning step?',
                ['Duplicate rows retention always', 'Consistent data formatting', 'Random text casing', 'Mixing currencies in one column'],
                1
              )
            ]
          })
        ]
      }),
      createChapter({
        title: 'Analytical Functions',
        description: 'Use formulas to summarize and investigate data.',
        lessons: [
          createLesson({
            title: 'Aggregate Functions and Summaries',
            description: 'Apply SUMIFS, COUNTIFS, and average calculations.',
            videoUrl: 'https://www.youtube.com/watch?v=2XgxBvHvgFY',
            durationMinutes: 18,
            content: 'Use conditional formulas to answer operational and financial questions quickly.',
            quizQuestions: [
              makeQuiz(
                'Which function is best for conditional totals?',
                ['LEFT', 'SUMIFS', 'TODAY', 'UPPER'],
                1
              )
            ]
          }),
          createLesson({
            title: 'Lookup and Mapping Patterns',
            description: 'Link datasets safely using lookups.',
            videoUrl: 'https://www.youtube.com/watch?v=4lvZfcauM-M',
            durationMinutes: 16,
            content: 'Learners use lookup logic to enrich datasets without manual copy errors.',
            quizQuestions: [
              makeQuiz(
                'Lookup formulas are used to:',
                ['Animate charts', 'Retrieve related values from another table', 'Delete worksheets', 'Lock the workbook'],
                1
              )
            ]
          })
        ]
      }),
      createChapter({
        title: 'Dashboards and Insights',
        description: 'Convert analysis into business-facing visuals.',
        lessons: [
          createLesson({
            title: 'Pivot Tables for Executive Summaries',
            description: 'Build dynamic summaries with drill-down capability.',
            videoUrl: 'https://www.youtube.com/watch?v=4lvZfcauM-M',
            durationMinutes: 19,
            content: 'Create pivot reports by region, period, and team to expose trends and exceptions.',
            quizQuestions: [
              makeQuiz(
                'Pivot tables are best used to:',
                ['Manually rewrite data', 'Summarize large datasets quickly', 'Hide all filters', 'Prevent sorting'],
                1
              )
            ]
          }),
          createLesson({
            title: 'Decision-Ready Dashboard Design',
            description: 'Design clean visuals for leadership reporting.',
            videoUrl: 'https://www.youtube.com/watch?v=uGcqA8L3pBY',
            durationMinutes: 17,
            content: 'Use consistent chart grammar, KPI cards, and audience-focused storytelling for decision meetings.',
            quizQuestions: [
              makeQuiz(
                'A strong dashboard should prioritize:',
                ['Visual noise', 'Clarity and decision support', 'Maximum colors', 'Random chart types'],
                1
              )
            ]
          })
        ]
      })
    ]
  }
]

const seedCourses = async () => {
  await mongoose.connect(mongoUri)
  try {
    const creator = await Account.findOne({ email: creatorEmail })
    if (!creator) {
      throw new Error(`Creator account not found: ${creatorEmail}`)
    }

    const now = new Date()
    let createdCount = 0
    let updatedCount = 0

    for (const course of courseSeed) {
      const basePayload = {
        organization: null,
        createdBy: creator._id,
        createdByName: creator.profile?.name || creator.email || 'Seemplify Learning',
        createdByEmail: creator.email || creatorEmail,
        title: course.title,
        summary: course.summary,
        description: course.description,
        category: course.category,
        level: course.level,
        tags: course.tags,
        banner: course.banner,
        pricing: course.pricing,
        visibility: 'organization_public',
        status: 'published',
        isSystemCourse: false,
        isActive: true,
        publishedAt: now,
        archivedAt: null,
        chapters: course.chapters
      }

      const existing = await SimpleLmsCourse.findOne({ title: course.title })
      if (existing) {
        Object.assign(existing, basePayload)
        await existing.save()
        updatedCount += 1
        // eslint-disable-next-line no-console
        console.log(`Updated course: ${course.title}`)
      } else {
        await SimpleLmsCourse.create(basePayload)
        createdCount += 1
        // eslint-disable-next-line no-console
        console.log(`Created course: ${course.title}`)
      }
    }

    // eslint-disable-next-line no-console
    console.log(`Seeding complete. Created: ${createdCount}, Updated: ${updatedCount}`)
  } finally {
    await mongoose.disconnect()
  }
}

seedCourses().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Failed to seed online courses:', error)
  process.exit(1)
})
