# Optional CV during every self-assessment

## 1. Employee experience

An employee completing an ordinary appraisal can choose **CV (optional)** above either the conversational or manual assessment. No occupational role, competency feature or ChatGPT connection is required. PDF, DOCX and TXT files up to 10 MiB are supported. An employee can submit without a CV.

Linked role assessments retain their existing CV flow. Optional role discovery has a five-second deadline; an unavailable or slow competency endpoint falls back to the ordinary uploader. Late responses cannot replace a selected file. Previously uploaded ordinary CVs remain accessible if a role is subsequently linked.

![Local browser verification with a fictional CV and mocked API responses.](report-assets/ordinary-cv-desktop-mocked.png)

[Mobile light](report-assets/ordinary-cv-mobile-light-mocked.png) · [Mobile dark](report-assets/ordinary-cv-mobile-dark-mocked.png). These are implementation screenshots with synthetic data, not production upload receipts.

## 2. Evidence and access

Ordinary CVs use the existing private appraisal document store with `category=cv`. The server validates content/type and enforces employee/reviewer visibility, tenant scope, employee or scoped reviewer access, and existing closed-appraisal restrictions. Uploading does not invoke AI or change a rating.

Successful extraction makes the document available as CV evidence to current and final appraisal analysis. Empty, failed, inaccessible or deleted content is excluded; processing gaps are explicit. The same file is not also counted as a generic document. Reviewers can download CVs from both their embedded and dedicated review workspace; the final report retains its existing download controls.

## 3. Recovery

Failed uploads retain the selected file. A successful upload followed by a failed list refresh shows the saved file and a list-refresh action instead of another upload action. Explicit fetching before updating the appraisal cache fixes an issue found during browser QA: revalidation alone could silently retain stale data. Existing review text remains governed by the draft-preserving hydration mechanism.

## 4. Verification

| Layer | Result |
| --- | --- |
| Backend | 130 checks passed across five integration suites, including 20 new CV cases; real disposable Mongo/HTTP/TXT extraction, synthetic storage transport |
| Browser | 29 cases passed across ordinary and linked CV suites; mocked API responses and fictional files |
| Build | Production Next.js build and TypeScript passed |
| Lint | Changed components passed; existing assessment files passed with their pre-existing `no-explicit-any` baseline excluded |
| Peer review | Backend access/evidence and frontend recovery reviewed independently; findings fixed |

Browser coverage includes both assessment modes, competency disabled, stalled discovery and late replies, upload/reload/download/removal, retry, failed refresh without duplicate upload, unreadable content, mobile themes, reviewer visibility and closed records. Backend checks cover cross-tenant and wrong-resource denial, closed states, invalid content/audiences, no AI invocation, and current/final CV evidence classification.

Commands:

```text
backend: node node_modules/jest/bin/jest.js --runInBand tests/appraisalCv.integration.test.js tests/appraisalCurrentAssessment.integration.test.js tests/appraisalPrivateStorage.integration.test.js tests/appraisalAiPolicy.integration.test.js tests/documentExtraction.integration.test.js
frontend: npx playwright test e2e/appraisal-optional-cv.spec.ts e2e/competency-cv-evidence.spec.ts --reporter=line
frontend: npm run build
```

Deployment and authenticated live evidence are recorded separately after publication. Existing completed appraisals are not reopened by this feature.
