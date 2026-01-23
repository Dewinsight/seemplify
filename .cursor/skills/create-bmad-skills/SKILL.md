---
name: create-bmad-skills
description: Creates Cursor skills that bridge to BMAD agents (do not replicate). Each skill loads _bmad agent files, config, and follows BMAD activation and menu-handlers. Use when generating or regenerating BMAD bridge skills in .cursor/skills/.
---

# Create BMAD Skills (bridge-only)

Creates Cursor skills that **delegate to BMAD**—they do **not** replicate persona, principles, or menus. Each skill is a thin bridge: load the BMAD agent, embody it, and run its workflows/exec/action per the agent’s menu-handlers.

## Principle: Use BMAD, don’t replicate

- **Persona, principles, menu, and handlers** stay in `_bmad/`. The skill only points at them.
- **Config**: BMM agents use `_bmad/bmm/config.yaml`; `bmad-master` uses `_bmad/core/config.yaml`.
- **Workflows**: `workflow="...yaml"` → run via `_bmad/core/tasks/workflow.xml` with that yaml as workflow-config.
- **Exec**: `exec="...md"` → load and execute that `.md`; if `data="..."` exists, pass it as context.
- **Action**: `action="text"` or `action="#id"` → run as inline instruction or from prompt `#id` in the agent XML.

## Agent locations

- **BMM**: `_bmad/bmm/agents/*.md` — `analyst`, `architect`, `dev`, `pm`, `quick-flow-solo-dev`, `sm`, `tea`, `tech-writer`, `ux-designer`
- **Core**: `_bmad/core/agents/bmad-master.md`

Config: BMM → `_bmad/bmm/config.yaml`; bmad-master → `_bmad/core/config.yaml`.

## Output: bridge SKILL.md template

For each agent, create `.cursor/skills/{skill-name}/SKILL.md` using this structure. Replace `{skill-name}`, `{agent-path}`, `{config-path}`, `{title}`, and `{description}` from the agent’s frontmatter and file path. Adjust the “Running capabilities” section if the agent uses only a subset of `workflow`, `exec`, `action` (e.g. bmad-master uses `action` and `exec`, no `workflow`).

```markdown
---
name: {skill-name}
description: Bridges to the BMAD {title} agent. Loads {agent-path} and follows its activation and workflows. Use when {short trigger scenarios from description/menu}.
---

# {Title} (BMAD bridge)

This skill **does not replicate** the {Title} agent. It **delegates to BMAD**.

## 1. Load the BMAD agent

- Read **`{agent-path}`** in full.
- Then read **`{config-path}`** and keep `user_name`, `communication_language`, `output_folder` (and any `{project-root}`) for the session.

## 2. Embody and run

- **Embody** the agent's persona and follow its **activation** and **&lt;rules&gt;** exactly as in that file.
- **Menu and handlers**: Use the **&lt;menu&gt;** and **&lt;menu-handlers&gt;** from the agent file. Do not re‑define them here.

## 3. Running capabilities (from the agent's menu)

- **`workflow="...yaml"`**
  - Load **`_bmad/core/tasks/workflow.xml`** and execute it with that `workflow.yaml` as the workflow config.
- **`exec="...md"`**
  - Load and **execute** the referenced `.md`. If the menu item has `data="..."`, pass that path as context to the exec'd file.
- **`action="text"`** (if the agent has this handler)
  - Execute the text as an inline instruction. Resolve `{project-root}` from the workspace root.
- **`action="#id"`** (if the agent has this handler)
  - Find the prompt with that `id` in the agent XML and execute its content.

## 4. Do not duplicate

- Persona, principles, menu items, and handlers stay in **`{agent-path}`**. This skill only points at BMAD and ensures the correct config and workflow/exec/action mechanics are used.
```

## Mapping table

| Agent file | Skill name | Config |
|------------|------------|--------|
| `_bmad/bmm/agents/analyst.md` | `analyst` | `_bmad/bmm/config.yaml` |
| `_bmad/bmm/agents/architect.md` | `architect` | `_bmad/bmm/config.yaml` |
| `_bmad/bmm/agents/dev.md` | `dev` | `_bmad/bmm/config.yaml` |
| `_bmad/bmm/agents/pm.md` | `pm` | `_bmad/bmm/config.yaml` |
| `_bmad/bmm/agents/quick-flow-solo-dev.md` | `quick-flow-solo-dev` | `_bmad/bmm/config.yaml` |
| `_bmad/bmm/agents/sm.md` | `sm` | `_bmad/bmm/config.yaml` |
| `_bmad/bmm/agents/tea.md` | `tea` | `_bmad/bmm/config.yaml` |
| `_bmad/bmm/agents/tech-writer.md` | `tech-writer` | `_bmad/bmm/config.yaml` |
| `_bmad/bmm/agents/ux-designer.md` | `ux-designer` | `_bmad/bmm/config.yaml` |
| `_bmad/core/agents/bmad-master.md` | `bmad-master` | `_bmad/core/config.yaml` |

For **bmad-master** and **tech-writer**, include `action` in “Running capabilities”; omit `workflow` for bmad-master if it has none. For **analyst**, some menu items use `data=` with `exec=`—always pass `data` as context when present.

## Execution workflow

1. **Discover**: List `_bmad/bmm/agents/*.md` and `_bmad/core/agents/*.md`.
2. **For each file**:
   - Derive `skill-name` from filename (e.g. `ux-designer.md` → `ux-designer`).
   - Set `agent-path` and `config-path` from the mapping table.
   - Read frontmatter for `description` and `name` to build the `description` and `{title}`.
   - Create `.cursor/skills/{skill-name}/SKILL.md` from the bridge template, adjusting “Running capabilities” to match the agent’s menu-handlers.
3. **Report**: List created/updated skills and their paths.

## Special cases

- **tech-writer**: Has `action="..."` menu items; include both `action` and `workflow`/`exec` in the bridge.
- **bmad-master**: Uses `_bmad/core/config.yaml`; menu has `action` and `exec` only—no `workflow` in “Running capabilities.”
- **analyst (and others with `data=`)**: For `exec="...md"`, pass `data="..."` as context when specified in the same menu item.
