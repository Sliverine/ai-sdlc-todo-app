# Hooks System

## Hook Types

- **PreToolUse**: Before tool execution (validation, parameter modification)
- **PostToolUse**: After tool execution (auto-format, checks)
- **Stop**: When session ends (final verification)

## Configuration Scopes

User-level hooks in `~/.claude/settings.json` are global to the current user and apply across projects. Project-level hooks belong in the repository's `.claude/settings.json` and are shared with the team. A repository-local settings file does not change the user's global settings.

This repository also keeps hook definitions in `.claude/hooks.json` as a project-maintained configuration file. `hooks.json` is not Claude Code's standard settings filename, so do not assume Claude Code loads it automatically; the runtime or setup process must explicitly load or merge its `hooks` object into the appropriate settings scope.

## User-Level (Global) Hooks

The following inventory describes the user-level hooks configured in `~/.claude/settings.json`. The separate repository hook definitions are in `.claude/hooks.json`.

### PreToolUse
- **tmux reminder**: Suggests tmux for long-running commands (npm, pnpm, yarn, cargo, etc.)
- **git push review**: Opens Zed for review before push
- **doc blocker**: Blocks creation of unnecessary .md/.txt files

### PostToolUse
- **PR creation**: Logs PR URL and GitHub Actions status
- **Prettier**: Auto-formats JS/TS files after edit
- **TypeScript check**: Runs tsc after editing .ts/.tsx files
- **console.log warning**: Warns about console.log in edited files

### Stop
- **console.log audit**: Checks all modified files for console.log before session ends

## Auto-Accept Permissions

Use with caution:
- Enable for trusted, well-defined plans
- Disable for exploratory work
- Never use dangerously-skip-permissions flag
- Configure `allowedTools` in `~/.claude.json` instead

## TodoWrite Best Practices

Use TodoWrite tool to:
- Track progress on multi-step tasks
- Verify understanding of instructions
- Enable real-time steering
- Show granular implementation steps

Todo list reveals:
- Out of order steps
- Missing items
- Extra unnecessary items
- Wrong granularity
- Misinterpreted requirements
