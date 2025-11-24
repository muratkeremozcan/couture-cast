# Repository Guidelines

## Project Structure & Module Organization
- `docs/` is the collaboration surface: `couturecast_brief.md` (positioning, audience) and `couturecast_roadmap.md` (release plan) drive every downstream artifact.
- `bmad/` is vendor-managed BMAD scaffolding; leave it untouched unless you deliberately rerun `npx bmad-method@alpha install` after an upstream update.
- Keep root-level helpers (like this guide) lightweight and point contributors back to the docs rather than duplicating narrative content.

## Maintaining Brief & Roadmap
- Edit the brief first when vision, personas, or success metrics shift; update the roadmap immediately after so phase names and milestones stay aligned.
- Add a short “Updated: YYYY-MM-DD — reason” line under each title and capture broader context in the PR description for traceability.
- Preserve existing table schemas and emoji markers to keep diffs legible and the voice consistent.

## Build, Test, and Development Commands
- `npx bmad-method@alpha install` (optional) refreshes BMAD payloads; run only when intentionally upgrading the framework.
- `npx markdownlint-cli2 docs/**/*.md` (if available) checks headings, spacing, and table formatting before you push.
- Preview Markdown locally (VS Code, Obsidian, GitHub web) to confirm emoji, tables, and callouts render cleanly.

## Coding Style & Naming Conventions
- Use ATX headings in sentence case (`## Target audience`) and prefer tight paragraphs with supporting bullet lists.
- Tables summarise key points—move long explanations into adjacent prose blocks.
- Stick to ASCII characters beyond the established emoji set; wrap lines near 100 characters to ease reviews.

## Testing Guidelines
- Cross-check roadmap phases against the brief’s scope before merge; resolve discrepancies or document them as risks.
- Verify external references (APIs, partners, tools) are current and replace stale links immediately.
- Record reviewer feedback in PR comments or linked issues instead of leaving inline TODOs.

## Commit & Pull Request Guidelines
- Follow Conventional Commits (`docs: refresh roadmap Q1 targets`) and scope each commit to a single document when practical.
- PR descriptions should summarise intent, list touched sections, and mention stakeholders consulted (product, design, engineering).
- Attach rendered screenshots or snippets when changing tables or emoji-heavy sections so reviewers can scan the delta quickly.

## Security & Configuration Tips
- Exclude secrets, sample accounts, and identifiable wardrobe data from the docs; use neutral placeholders instead.
- Leave `{project-root}/bmad/core/config.yaml` as generated and store any local overrides outside version control.
