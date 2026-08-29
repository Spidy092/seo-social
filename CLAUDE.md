# Project Agent Rules

This project uses my global AI agent kit.

Global reusable skills live here:
`~/.ai-agents/.agents/skills`

## Project Context

Fill this once per project:

- Main stack:
- Package manager:
- Dev command:
- Test command:
- Build command:
- Deploy target:
- Important folders:
- Do not edit:

## Rules

- Read existing code before changing.
- Make the smallest safe change.
- Do not rewrite unrelated code.
- Do not delete files, reset DB, or force push without asking.
- Give exact files changed.
- Give exact commands to test.
- Mention edge cases.
- Use global skills when relevant:
  - debugging
  - code-review
  - testing
  - refactor
  - devops-deploy
  - security-audit
  - frontend-ui
  - docs-research
  - rtk-prompting
  - caveman-fast-fix

## Output Format

For serious work:

```md
## Summary
## What I found
## Fix / Changes
## Files changed
## Commands to run
## Verification
## Risks / Edge cases
```

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec
