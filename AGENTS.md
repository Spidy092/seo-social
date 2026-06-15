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
