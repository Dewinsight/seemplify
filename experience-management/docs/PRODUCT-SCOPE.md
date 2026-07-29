# Product scope and XEBO research map

This implementation is an original Seemplify product with feature parity goals, not a copy of XEBO trademarks or proprietary source code.

## Researched capability map

| XEBO capability | Seemplify Experience implementation |
| --- | --- |
| CX, EX, and market-research suites | Survey purpose, templates, metrics, and analysis presets |
| Survey from one prompt | Terra structured survey generation |
| 20+ question types | Extensible question registry and respondent renderers |
| Skip, display, and branch logic | Question-level rules in the survey data model and respondent renderer |
| Themes and multilingual surveys | Theme settings and Terra translation jobs |
| Web, email, API, QR, manual, kiosk collection | Collector records and public collector routes |
| Invitations, reminders, thank-you messages | Brevo transactional email workflows |
| NPS, CSAT, CES | Deterministic calculation and trend views |
| Question summary and individual responses | Aggregate charts plus response detail |
| Dropout analysis | Completion and question-reach funnel |
| Sentiment and emotion | Terra response classification with confidence and evidence |
| Topic/aspect analysis | Terra theme and aspect extraction |
| Key-driver analysis | Pearson correlations against the selected outcome metric |
| Ask questions of feedback | Grounded Terra analyst chat over bounded response evidence |
| Action-ready insights | Risk flags, opportunities, and recommended actions |
| Audio/video feedback analysis | Media feedback intake and transcript-aware analysis; speech transcription is isolated behind a provider interface |
| Closing the loop | Service-recovery tickets linked to responses |
| Exports and reports | CSV/JSON exports and Terra executive reports |

## AI invariants

All six experience-management AI activities are locked to the managed local provider. They never fall back to Groq. The backend signs every gateway request, supplies a durable metering identity, persists the job before dispatch, and retries local outages without discarding the job.

The AI prompt always treats respondent data as untrusted content and requires evidence from supplied responses. Structured outputs are schema validated before being stored.
