const pageOne = `ADA OKAFOR
Principal Software Engineer
London, United Kingdom | ada.okafor@example.test | +44 7700 900123
https://www.linkedin.com/in/ada-okafor | https://github.com/adaokafor

PROFESSIONAL PROFILE
Principal software engineer with twelve years of experience designing reliable recruitment, payments, and analytics platforms. Experienced in technical leadership, distributed systems, privacy engineering, cloud infrastructure, and mentoring multidisciplinary teams. Led programmes serving more than four million monthly users while maintaining measurable availability and cost targets.

CORE SKILLS
TypeScript, JavaScript, Node.js, Python, Go, React, Next.js, PostgreSQL, Redis, MongoDB, Kafka, BullMQ, GraphQL, REST, AWS, Kubernetes, Terraform, Docker, OpenTelemetry, Prometheus, Grafana, GitHub Actions, Playwright, Jest, system design, incident response, data protection, technical leadership.

PROFESSIONAL EXPERIENCE
Principal Software Engineer — Northstar Systems, London — January 2023 to Present
- Technical lead for a recruitment platform used by 1,200 organisations and four million candidates.
- Designed a durable BullMQ and MongoDB document-processing pipeline with idempotency keys, bounded retries, dead-letter recovery, and fair scheduling between organisations.
- Reduced candidate ingestion p95 latency from 94 seconds to 31 seconds while preserving extraction accuracy.
- Introduced OpenTelemetry tracing, Prometheus service-level indicators, and Grafana incident dashboards.
- Led architecture reviews for eight engineers and mentored three senior engineers into staff-level responsibilities.
- Delivered regional data isolation and retention controls with the security and legal teams.
- Technologies: TypeScript, Node.js, PostgreSQL, Redis, BullMQ, React, AWS, Kubernetes, Terraform.

Senior Software Engineer — Harbor Labs, Bristol — June 2019 to December 2022
- Built payment orchestration services processing £180 million annually with audited reconciliation.
- Migrated twelve synchronous workflows to Kafka event streams and reduced peak failure rates by 62 percent.
- Implemented a tokenisation service and PCI-aligned access controls without storing raw card numbers.
- Coordinated zero-downtime PostgreSQL migrations across five services.
- Served as incident commander for high-severity production events and created recovery exercises.
- Technologies: Go, TypeScript, Kafka, PostgreSQL, Redis, AWS, Docker, Grafana.

Software Engineer — Meridian Health Technology, Manchester — September 2016 to May 2019
- Developed clinical scheduling APIs and accessible React interfaces for NHS partner organisations.
- Replaced manual deployment steps with GitHub Actions and Terraform, reducing release time from two hours to eighteen minutes.
- Added contract, integration, and browser tests that reduced escaped defects by 41 percent.
- Technologies: Node.js, React, PostgreSQL, Python, AWS, Terraform, Playwright.`;

const pageTwo = `ADA OKAFOR — CURRICULUM VITAE — PAGE 2

EARLIER EXPERIENCE
Graduate Software Engineer — Elm Research, Leeds — July 2013 to August 2016
- Created Python data-quality tools for longitudinal research datasets.
- Built internal dashboards and automated monthly statistical reports.
- Paired with research analysts to document reproducible data-processing methods.
- Technologies: Python, SQL, JavaScript, Linux.

SELECTED PROJECTS
CV Processing Reliability Programme — 2024
Role: Technical lead
- Designed queue admission, signed inference requests, schema validation, stale-job recovery, and status-token isolation.
- Demonstrated restart-safe processing with no duplicate candidate or credit creation during failure injection.
- Measured throughput, p50/p95 latency, GPU memory, malformed JSON, timeouts, and recovery time.

Atlas Observability Platform — 2022
Role: Lead engineer
- Standardised OpenTelemetry traces and service metadata across 37 services.
- Built SLO dashboards and burn-rate alerts that reduced mean time to detection by 54 percent.
- Published migration guides and ran workshops for engineering and support teams.

Harbor Ledger Reconciliation — 2021
Role: Senior engineer
- Implemented deterministic ledger comparison, exception queues, and signed audit exports.
- Reconciled more than 99.99 percent of daily records automatically.

Community Appointment Access — 2018
Role: Full-stack engineer
- Built a WCAG 2.1 AA appointment interface and offline-friendly clinic workflow.
- Conducted usability sessions with clinicians and patient advocates.

EDUCATION
MSc Distributed Systems, Imperial College London, 2018, Distinction.
Dissertation: Practical failure recovery for event-driven services.

BSc Computer Science, University of Bristol, 2013, First Class Honours.
Final project: Privacy-preserving analysis of public transport demand.

CERTIFICATIONS
AWS Certified Solutions Architect – Professional, Amazon Web Services, issued March 2024, expires March 2027.
Certified Kubernetes Administrator, Cloud Native Computing Foundation, issued November 2022, expires November 2025.
Professional Scrum Master I, Scrum.org, issued May 2020.

PUBLICATIONS AND TALKS
"Designing Restart-Safe Document Pipelines", Platform Engineering London, October 2024.
"Operational Lessons from Event-Driven Payments", Software Architecture Review, volume 12, 2022.
"Useful SLOs for Small Teams", Bristol Engineering Forum, June 2021.

AWARDS
Northstar Engineering Impact Award, Northstar Systems, December 2024, for the CV Processing Reliability Programme.
Harbor Reliability Award, Harbor Labs, November 2021, for ledger reconciliation and incident leadership.`;

const pageThree = `ADA OKAFOR — CURRICULUM VITAE — PAGE 3

LEADERSHIP AND PROFESSIONAL SERVICE
- Architecture council member responsible for reliability and data-governance standards.
- Hiring panel chair for senior and staff engineering roles; designed structured technical interview rubrics.
- Mentor with Code First Girls since 2020, supporting career changers entering backend engineering.
- Volunteer technical adviser to Digital Access Bristol from 2019 to 2022.
- Member of the British Computer Society and the Association for Computing Machinery.

SELECTED TECHNICAL OUTCOMES
- Four million monthly users supported by the Northstar platform.
- 99.95 percent document-processing availability target achieved over four consecutive quarters.
- 38 percent reduction in infrastructure cost per processed candidate.
- 62 percent reduction in peak payment-workflow failure rate at Harbor Labs.
- 54 percent reduction in mean time to detection after the Atlas observability rollout.
- 41 percent reduction in escaped defects for Meridian scheduling releases.

LANGUAGES
English — fluent.
Igbo — native.
French — conversational.

ADDITIONAL TRAINING
Advanced Incident Command, Resilience Academy, 2023.
Privacy Engineering Fundamentals, IAPP, 2022.
Inclusive Technical Leadership, LeadDev, 2021.

OPEN SOURCE
- Maintainer of queue-inspector, a TypeScript diagnostic utility for Redis-backed work queues.
- Contributor to OpenTelemetry JavaScript instrumentation documentation.
- Published reference examples for idempotent Node.js workers and PostgreSQL advisory locks.

WORKING PRACTICES
Ada works with product, design, security, legal, support, and data teams to turn operational constraints into measurable engineering decisions. She writes architecture decision records, defines rollback and recovery criteria before launch, and favours small reversible changes. Her leadership approach combines clear ownership with hands-on technical coaching.

INTERESTS
Long-distance running, community technology education, analogue photography, and West African literature.

REFERENCES
Available on request.`;

const cvText = [pageOne, pageTwo, pageThree].join('\n\f\n');
const expectedDetails = [
  'Northstar Systems',
  'Harbor Labs',
  'Meridian Health Technology',
  'Elm Research',
  'Imperial College London',
  'University of Bristol',
  'AWS Certified Solutions Architect',
  'Certified Kubernetes Administrator',
  'CV Processing Reliability Programme',
  'Atlas Observability Platform',
  'English',
  'Igbo'
];
const forbiddenDetails = ['Google', 'Microsoft', 'Doctor of Philosophy', 'PhD', 'Cambridge'];
const cvSchema = {
  type: 'object',
  additionalProperties: true,
  required: [
    'firstName', 'lastName', 'email', 'phone', 'location', 'position', 'experience',
    'education', 'skills', 'summary', 'strengths', 'potentialFlags', 'workExperience',
    'educationHistory', 'certifications', 'languages', 'awards', 'projects', 'publications',
    'volunteerWork', 'professionalMemberships', 'portfolioLinks', 'additionalSections', 'fullCVData'
  ],
  properties: {
    firstName: { type: 'string' },
    lastName: { type: 'string' },
    email: { type: 'string' },
    phone: { type: 'string' },
    location: { type: 'string' },
    position: { type: 'string' },
    experience: { type: 'string' },
    education: { type: 'string' },
    skills: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    strengths: { type: 'array', items: { type: 'string' } },
    potentialFlags: { type: 'array', items: { type: 'string' } },
    workExperience: { type: 'object' },
    educationHistory: { type: 'array', items: { type: 'object' } },
    certifications: { type: 'array', items: { type: 'object' } },
    languages: { type: 'array', items: { type: 'object' } },
    awards: { type: 'array', items: { type: 'object' } },
    projects: { type: 'array', items: { type: 'object' } },
    publications: { type: 'array', items: { type: 'object' } },
    volunteerWork: { type: 'array', items: { type: 'object' } },
    professionalMemberships: { type: 'array', items: { type: 'object' } },
    portfolioLinks: { type: 'object' },
    additionalSections: { type: 'object' },
    fullCVData: { type: 'object' }
  }
};

function scoreCvOutput(data) {
  const serialized = JSON.stringify(data || {}).toLowerCase();
  const skills = Array.isArray(data?.skills) ? data.skills.map((value) => String(value).toLowerCase()) : [];
  const essentialChecks = {
    firstName: String(data?.firstName || '').toLowerCase() === 'ada',
    lastName: String(data?.lastName || '').toLowerCase() === 'okafor',
    email: String(data?.email || '').toLowerCase() === 'ada.okafor@example.test',
    phone: String(data?.phone || '').includes('7700 900123'),
    location: String(data?.location || '').toLowerCase().includes('london'),
    position: /principal software engineer/i.test(String(data?.position || '')),
    skills: ['typescript', 'node.js', 'postgresql', 'kubernetes', 'terraform', 'opentelemetry']
      .every((expected) => skills.some((skill) => skill.includes(expected)))
  };
  const detailChecks = expectedDetails.map((value) => ({
    value,
    found: serialized.includes(value.toLowerCase())
  }));
  const hallucinations = forbiddenDetails.filter((value) => serialized.includes(value.toLowerCase()));
  const detailRecall = detailChecks.filter((check) => check.found).length / detailChecks.length;
  return {
    passed: Object.values(essentialChecks).every(Boolean) && detailRecall >= 0.75 && hallucinations.length === 0,
    essentialChecks,
    detailChecks,
    detailRecall,
    hallucinations
  };
}

module.exports = {
  cvSchema,
  cvText,
  expectedDetails,
  forbiddenDetails,
  pageCount: 3,
  scoreCvOutput
};
