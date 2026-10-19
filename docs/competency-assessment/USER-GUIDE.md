# Run a role-based assessment

This guide describes the implemented interface. Check [STATUS.md](STATUS.md) for deployment and provider acceptance; local screenshots use synthetic people.

1. Open **Competency assessments** in Performance. An authorised organisation administrator or HR manager can select **Enable competency assessments**. This enables the tools; it does not start appraisals or turn on AI or recording.
2. In **Frameworks**, create and publish the internal or supplied SFIA definitions you need, including their native level descriptions. In **Strategy**, publish outcomes if you want strategy criteria. You can use any nonempty combination of these three sources.
3. In **Role library**, create a role manually or upload a TXT, PDF or DOCX role description. Review the extracted draft. Map responsibilities to published criteria and expected levels or numeric targets, then publish the role version.
4. In **Cycles**, select published sources and role versions. Configure explicit numeric conversions, weights and classification bands. Review validation errors before publishing; native level names do not automatically become comparable scores.
5. Open the existing **Start appraisal** flow. Choose employees and eligible reviewers. In the review details, enable role comparison, choose the published competency cycle and select each person's role version. Confirm and start. The receipt links to the appraisal and reports any role link that needs retrying.
6. Open the linked role assessment. Review the frozen role expectations, attach permitted evidence, record structured oral questions and answers if needed, and save observed findings with a rationale. **Manual assessment works without AI or calls.**
7. Complete and submit the ordinary manager review where applicable. Its submitted overall, goal, competency and custom answers appear in the final report with their actual author and dates. An unsubmitted manager draft remains private.
8. In **Completion & outcome**, resolve missing items or use an authorised, recorded exception. Review the calculated suggestion, choose the human final outcome and finalise. The report preserves the exact role, source definitions, feedback and calculation used.
9. View or download the participant report with the appropriate permission. Cohort reports filter by the viewer's current scope and only rank comparable assessments. Reopening creates a later report revision; it does not replace earlier published history.

## Optional integrations

An authorised administrator configures the processing notice and retention periods in **Assessment settings** before enabling AI drafts or recorded-call evidence. Each requester uses their own connected ChatGPT account and applicable consent. AI observations remain editable, cited drafts and do not select a score or final outcome.

For a new recorded calendar meeting, each actual participant separately acknowledges recording and transcription before the Nylas notetaker can start. Linking calendar or in-app call material to an assessment also requires the applicable source and assessment-purpose permission. Withdrawing source consent blocks further use; it does not silently grant access to existing private recordings. A manual oral assessment remains available when an integration is unavailable.

## Recovery

- A role-link retry uses the saved appraisal rather than creating another appraisal.
- If someone else saved first, compare the current version and preserve your draft before reloading.
- Editing a role creates a new version; an existing assessment retains its frozen version.
- A missing or withdrawn source is an access issue, not a low performance score. Resolve the source or record an authorised exception.
