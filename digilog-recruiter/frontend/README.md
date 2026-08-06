# SmartHR Sterling

A modern, AI-powered HR recruitment management platform built with Next.js, TypeScript, and Tailwind CSS.

[![Built with Next.js](https://img.shields.io/badge/Built%20with-Next.js%2015-black?style=for-the-badge&logo=next.js)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?style=for-the-badge&logo=typescript)](https://www.typescriptlang.org)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind%20CSS-3.4-38B2AC?style=for-the-badge&logo=tailwind-css)](https://tailwindcss.com)

## 🚀 Overview

SmartHR Sterling revolutionizes the recruitment process by providing HR teams with intelligent, efficient, and user-friendly tools that enhance decision-making and improve hiring outcomes. Our platform combines modern UI/UX design with powerful features to streamline every aspect of recruitment.

### ✨ Key Features

- **📊 Real-time Dashboard** - Track recruitment metrics, activity feeds, and performance analytics
- **👥 Candidate Management** - Advanced filtering, AI-powered matching, and pipeline tracking
- **💼 Job Postings** - Create and manage job openings with integrated applicant tracking
- **📄 Bulk CV Processing** - Upload and process multiple resumes with AI parsing
- **🤖 AI Assistant** - Intelligent recruitment assistance and automated insights
- **👨‍👩‍👧‍👦 Team Collaboration** - Role-based permissions and activity tracking
- **💳 Billing & Settings** - Subscription management and platform configuration

## 🛠️ Tech Stack

- **Frontend Framework:** Next.js 15.2.4 with App Router
- **Language:** TypeScript 5.x
- **Styling:** Tailwind CSS 3.4.17
- **UI Components:** Radix UI primitives with shadcn/ui patterns
- **Icons:** Lucide React
- **Forms:** React Hook Form with Zod validation
- **Charts:** Recharts
- **Animations:** Tailwind Animate

## 📦 Installation

### Prerequisites

- Node.js 18.17 or later
- pnpm (recommended) or npm/yarn

### Getting Started

1. Clone the repository:
```bash
git clone https://github.com/your-org/smarthr-sterling.git
cd smarthr-sterling
```

2. Install dependencies:
```bash
pnpm install
```

3. Set up environment variables:
```bash
cp .env.example .env.local
```

4. Run the development server:
```bash
pnpm dev
```

5. Open [http://localhost:3000](http://localhost:3000) in your browser.

## 🏗️ Project Structure

```
smarthr-sterling/
├── app/                    # Next.js App Router pages
│   ├── assistant/         # AI Assistant feature
│   ├── bulk-upload/       # Bulk CV upload
│   ├── candidates/        # Candidate management
│   ├── jobs/             # Job postings
│   └── settings/         # Settings and billing
├── components/           # Reusable React components
│   └── ui/              # UI component library
├── hooks/               # Custom React hooks
├── lib/                 # Utility functions
├── public/              # Static assets
├── scripts/             # Build scripts
├── styles/              # Global styles
└── tasks/               # TaskMaster documentation tasks
```

## 📚 Documentation

Comprehensive documentation is available in the following locations:

- **Main Documentation:** [`SMARTHR_STERLING_DOCUMENTATION.md`](./SMARTHR_STERLING_DOCUMENTATION.md)
- **Cursor Rules:** [`.cursorrules`](./.cursorrules) - AI assistant guidelines
- **Component Docs:** Coming soon in `/docs/components/`
- **API Reference:** Coming soon in `/docs/api/`

## 🚀 Deployment

### Vercel (Recommended)

1. Push your code to GitHub
2. Import the repository in Vercel
3. Configure environment variables
4. Deploy with automatic CI/CD

### Environment Variables

```env
# API Configuration
NEXT_PUBLIC_API_URL=https://api.your-domain.com
NEXT_PUBLIC_APP_URL=https://your-domain.com

# Optional Services
NEXT_PUBLIC_ANALYTICS_ID=your-analytics-id
NEXT_PUBLIC_SENTRY_DSN=your-sentry-dsn
```

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guidelines](./CONTRIBUTING.md) for details.

### Development Workflow

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Commit Convention

We use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` New features
- `fix:` Bug fixes
- `docs:` Documentation changes
- `style:` Code style changes
- `refactor:` Code refactoring
- `test:` Test updates
- `chore:` Maintenance tasks

## 📊 Task Management

This project uses TaskMaster for documentation task management. View current tasks:

```bash
# View all tasks
pnpm taskmaster get-tasks

# View next task
pnpm taskmaster next-task

# Update task status
pnpm taskmaster set-status --id 1 --status done
```

## 🧪 Testing

```bash
# Run tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Generate coverage report
pnpm test:coverage
```

## 📝 License

This project is proprietary software. All rights reserved.

## 🆘 Support

- **Documentation:** See [`SMARTHR_STERLING_DOCUMENTATION.md`](./SMARTHR_STERLING_DOCUMENTATION.md)
- **Issues:** [GitHub Issues](https://github.com/your-org/smarthr-sterling/issues)
- **Email:** support@smarthr-sterling.com

---

Built with ❤️ by the SmartHR Sterling Team
