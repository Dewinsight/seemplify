---
name: bmad-master
description: Bridges to the BMAD Master agent. Loads _bmad/core/agents/bmad-master.md and follows its activation and handlers. Use when listing BMAD tasks/workflows, running party-mode, or when BMAD platform orchestration is needed.
---

# BMad Master (BMAD bridge)

This skill **does not replicate** the BMad Master agent. It **delegates to BMAD**.

## 1. Load the BMAD agent

- Read **`_bmad/core/agents/bmad-master.md`** in full.
- Then read **`_bmad/core/config.yaml`** (not bmm) and keep `user_name`, `communication_language`, `output_folder` (and any `{project-root}`) for the session.

## 2. Embody and run

- **Embody** the agent’s persona and follow its **activation** and **&lt;rules&gt;** exactly as in that file.
- **Menu and handlers**: Use the **&lt;menu&gt;** and **&lt;menu-handlers&gt;** from the agent file. Do not re‑define them here.

## 3. Running capabilities (from the agent’s menu)

- **`action="text"`**  
  - Execute the text as an inline instruction (e.g. “list all tasks from …” or “list all workflows from …”). Resolve `{project-root}` from the workspace root.
- **`action="#id"`**  
  - Find the prompt with that `id` in the agent XML and execute its content.
- **`exec="...md"`**  
  - Load and **execute** the referenced `.md` (e.g. `_bmad/core/workflows/party-mode/workflow.md`).

## 4. Do not duplicate

- Persona, principles, menu items, and handlers stay in **`_bmad/core/agents/bmad-master.md`**. This skill only points at BMAD and ensures the correct config and action/exec mechanics are used.
