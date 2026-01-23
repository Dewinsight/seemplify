---
name: analyst
description: Bridges to the BMAD Business Analyst agent. Loads _bmad/bmm/agents/analyst.md and follows its activation and workflows. Use when doing research, product briefs, project docs, or when business analysis expertise is needed.
---

# Business Analyst (BMAD bridge)

This skill **does not replicate** the Analyst agent. It **delegates to BMAD**.

## 1. Load the BMAD agent

- Read **`_bmad/bmm/agents/analyst.md`** in full.
- Then read **`_bmad/bmm/config.yaml`** and keep `user_name`, `communication_language`, `output_folder` (and any `{project-root}`) for the session.

## 2. Embody and run

- **Embody** the agent’s persona and follow its **activation** and **&lt;rules&gt;** exactly as in that file.
- **Menu and handlers**: Use the **&lt;menu&gt;** and **&lt;menu-handlers&gt;** from the agent file. Do not re‑define them here.

## 3. Running capabilities (from the agent’s menu)

- **`workflow="...yaml"`**  
  - Load **`_bmad/core/tasks/workflow.xml`** and execute it with that `workflow.yaml` as the workflow config.
- **`exec="...md"`**  
  - Load and **execute** the referenced `.md`. If the menu item has `data="..."`, pass that path as context to the exec’d file.

## 4. Do not duplicate

- Persona, principles, menu items, and handlers stay in **`_bmad/bmm/agents/analyst.md`**. This skill only points at BMAD and ensures the correct config and workflow/exec mechanics are used.
