# Product scope and XEBO research map

This implementation is an original Seemplify product with feature parity goals, not a copy of XEBO trademarks or proprietary source code.

## Researched capability map

| XEBO capability | Seemplify Experience implementation |
| --- | --- |
| CX, EX, and market-research suites | Survey purpose, templates, metrics, and analysis presets |
| Survey from one prompt | Terra structured survey generation |
| 20+ question types | 22 implemented question types, including multi-NPS, graphical rating, matrix, ranking, media, and structured text |
| Skip, display, and branch logic | Question-level rules in the survey data model and respondent renderer |
| Themes and multilingual surveys | Theme settings and Terra translation jobs |
| Web, email, API, QR, manual, kiosk collection | Collector records and public collector routes |
| Invitations, reminders, thank-you messages | Brevo transactional email workflows |
| NPS, CSAT, CES | Deterministic calculation and trend views |
| Question summary and individual responses | Aggregate charts plus response detail |
| Dropout analysis | Completion and question-reach funnel |
| Sentiment and emotion | Terra response classification with confidence and evidence |
| Topic/aspect analysis | Terra theme and aspect extraction |
| Social listening | Import/API-fed public mentions with Terra sentiment, emotion, theme, trend, risk, and opportunity analysis |
| AI-assisted journey mapping | Terra journey generation and optimization with touchpoints, emotions, friction, metrics, and actions per stage |
| Key-driver analysis | Pearson correlations against the selected outcome metric |
| Ask questions of feedback | Grounded Terra analyst chat over bounded response evidence |
| Action-ready insights | Risk flags, opportunities, and recommended actions |
| Audio/video feedback analysis | Media feedback intake and transcript-aware analysis; speech transcription is isolated behind a provider interface |
| Closing the loop | Service-recovery tickets linked to responses |
| Exports and reports | CSV/JSON exports and Terra executive reports |

## AI invariants

All eight experience-management AI activities are locked to the managed local provider. They never fall back to Groq. The backend signs every gateway request, supplies a durable metering identity, persists the job before dispatch, and retries local outages without discarding the job.

The AI prompt always treats respondent data as untrusted content and requires evidence from supplied responses. Structured outputs are schema validated before being stored.

Social listening deliberately operates on public mentions imported by an administrator or an approved API integration. It does not pretend to scrape an entire social network without platform credentials, and every aggregate is explicitly bounded to the imported dataset.

## Primary research sources

- [XEBO Social Listening](https://www.xebo.ai/social-listening)
- [XEBO AI-powered customer journey mapping](https://www.xebo.ai/blog/transform-customer-experiences-with-ai-powered-journey-mapping-with-xebo-ai)
- [XEBO platform capabilities and pricing](https://www.xebo.ai/pricing)
- [XEBO question types](https://help.xebo.ai/docs/question-types-overview)
- [XEBO logic types](https://help.xebo.ai/docs/logic-types-overview)
- [shadcn/ui dashboard blocks](https://ui.shadcn.com/blocks?category=dashboard)
