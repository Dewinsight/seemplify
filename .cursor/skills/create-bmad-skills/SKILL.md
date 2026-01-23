---
name: create-bmad-skills
description: Converts BMAD agent definitions from _bmad directory into Cursor skills. Reads agent files, extracts persona, role, principles, and capabilities, then creates SKILL.md files in .cursor/skills/. Use when the user wants to create Cursor skills from BMAD agents or migrate BMAD agents to Cursor skill format.
---

# Create BMAD Skills

Converts BMAD (Business Method and Architecture Design) agent definitions into Cursor skills format.

## Overview

BMAD agents are defined in `_bmad/bmm/agents/` and `_bmad/core/agents/` as markdown files with XML-like agent definitions. This skill:

1. Reads all BMAD agent files
2. Extracts agent persona, role, identity, communication style, principles, and menu items
3. Converts them to Cursor skill format
4. Creates SKILL.md files in `.cursor/skills/{agent-name}/`

## BMAD Agent Structure

BMAD agents contain:
- **YAML frontmatter**: `name` and `description`
- **XML-like agent definition** with:
  - Agent metadata (id, name, title, icon)
  - Activation steps
  - Persona (role, identity, communication_style, principles)
  - Menu items and handlers
  - Rules

## Conversion Process

### Step 1: Discover All BMAD Agents

Scan for agent files:
- `{project-root}/_bmad/bmm/agents/*.md`
- `{project-root}/_bmad/core/agents/*.md`

### Step 2: Parse Each Agent File

For each agent file:

1. **Read the file** completely
2. **Extract YAML frontmatter**:
   - `name`: Use as skill directory name (convert to lowercase, hyphens)
   - `description`: Use as skill description base

3. **Parse XML-like structure**:
   - Extract `<agent>` attributes: `name`, `title`, `icon`
   - Extract `<persona>` section:
     - `<role>`: Primary role description
     - `<identity>`: Background/expertise
     - `<communication_style>`: How agent communicates
     - `<principles>`: Decision-making philosophy (array)
   - Extract `<menu>` items: Available capabilities
   - Extract `<rules>`: Behavioral constraints

### Step 3: Create Cursor Skill Structure

For each agent, create:

```
.cursor/skills/{agent-name}/
├── SKILL.md
```

**SKILL.md format:**

```markdown
---
name: {agent-name}
description: {role} specializing in {key-capabilities}. {communication_style_summary}. Use when {trigger_scenarios}.
---

# {Agent Title}

## Role and Identity

**Role**: {role}

**Identity**: {identity}

**Communication Style**: {communication_style}

## Core Principles

{principles as bullet list}

## Key Capabilities

{menu items converted to capabilities}

## Usage

When to use this agent:
- {trigger scenarios based on role and menu items}

## Behavioral Rules

{rules converted to guidelines}
```

### Step 4: Conversion Details

**Name Conversion**:
- Convert agent name to lowercase
- Replace underscores with hyphens
- Example: `quick-flow-solo-dev` → `quick-flow-solo-dev`

**Description Creation**:
- Start with role from persona
- Add key capabilities from menu items
- Include communication style hint
- Add trigger scenarios

**Principles Formatting**:
- Convert XML `<principles>` array to markdown bullet list
- Preserve original formatting and emphasis

**Menu Items**:
- Extract menu item descriptions
- Convert to capability descriptions
- Note workflow/exec handlers as capabilities

**Rules Conversion**:
- Convert XML `<rules>` to behavioral guidelines
- Make them actionable instructions

## Example Conversion

**Input** (`_bmad/bmm/agents/pm.md`):
```markdown
---
name: "pm"
description: "Product Manager"
---

<agent name="John" title="Product Manager" icon="📋">
  <persona>
    <role>Product Manager specializing in collaborative PRD creation</role>
    <identity>Product management veteran with 8+ years...</identity>
    <communication_style>Asks 'WHY?' relentlessly...</communication_style>
    <principles>- Channel expert product manager thinking...</principles>
  </persona>
  <menu>
    <item cmd="CP" exec="...">[CP] Create Product Requirements Document</item>
  </menu>
</agent>
```

**Output** (`.cursor/skills/pm/SKILL.md`):
```markdown
---
name: pm
description: Product Manager specializing in collaborative PRD creation through user interviews, requirement discovery, and stakeholder alignment. Asks 'WHY?' relentlessly like a detective. Use when creating PRDs, validating requirements, managing product features, or when product management expertise is needed.
---

# Product Manager

## Role and Identity

**Role**: Product Manager specializing in collaborative PRD creation through user interviews, requirement discovery, and stakeholder alignment.

**Identity**: Product management veteran with 8+ years launching B2B and consumer products. Expert in market research, competitive analysis, and user behavior insights.

**Communication Style**: Asks 'WHY?' relentlessly like a detective on a case. Direct and data-sharp, cuts through fluff to what actually matters.

## Core Principles

- Channel expert product manager thinking: draw upon deep knowledge of user-centered design, Jobs-to-be-Done framework, opportunity scoring, and what separates great products from mediocre ones
- PRDs emerge from user interviews, not template filling - discover what users actually need
- Ship the smallest thing that validates the assumption - iteration over perfection
- Technical feasibility is a constraint, not the driver - user value first
- Find if this exists, if it does, always treat it as the bible I plan and execute against: `**/project-context.md`

## Key Capabilities

- Create Product Requirements Document (PRD)
- Validate PRD
- Edit PRD
- Create Epics and User Stories from PRD
- Implementation Readiness Review
- Course Correction Analysis
- Workflow Status Management

## Usage

When to use this agent:
- Creating or editing Product Requirements Documents
- Validating product requirements
- Breaking down PRDs into epics and user stories
- Reviewing implementation readiness
- Analyzing project course corrections
- Product management discussions and planning

## Behavioral Rules

- ALWAYS communicate in configured language UNLESS contradicted by communication_style
- Stay in character until exit selected
- Display Menu items as the item dictates and in the order given
- Load files ONLY when executing a user chosen workflow or a command requires it, EXCEPTION: agent activation step 2 config.yaml
```

## Execution Workflow

When user requests to create BMAD skills:

1. **Discover agents**: List all `.md` files in `_bmad/bmm/agents/` and `_bmad/core/agents/`
2. **For each agent**:
   - Read the agent file
   - Parse XML structure
   - Create `.cursor/skills/{agent-name}/` directory
   - Generate `SKILL.md` with converted content
3. **Report**: List all created skills with their names and descriptions

## Special Handling

**BMAD-specific elements to adapt**:
- **Config loading**: BMAD agents load `config.yaml` - note this in skill but adapt for Cursor context
- **Workflow execution**: BMAD workflows use `workflow.yaml` - convert to Cursor skill capabilities
- **Menu handlers**: Convert workflow/exec handlers to capability descriptions
- **Activation steps**: Convert BMAD activation steps to skill usage guidelines

**Path references**:
- Convert `{project-root}` references to relative paths or note them as project-specific
- Keep workflow references but note they may need adaptation

## Notes

- Preserve the agent's personality and communication style
- Make principles actionable for Cursor AI
- Convert menu-driven interface to capability-based descriptions
- Maintain the agent's expertise and domain knowledge
- Adapt BMAD-specific workflows to Cursor skill patterns
