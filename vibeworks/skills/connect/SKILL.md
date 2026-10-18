---
name: connect
description: Connect the VibeWorks plugin so each Claude Code session reports its counts and timings to the person's VibeWorks profile. Use when they ask to connect, set up, or link VibeWorks in Claude Code.
---

Connect this machine's VibeWorks plugin.

1. Call the VibeWorks tool `connect_claude_code`. If the VibeWorks server is not signed in yet, tell the person to run `/mcp`, pick VibeWorks, and sign in, then try again.
2. Show the person what the reply says will be written: a small file at `~/.claude/vibeworks/token.json` holding a token and the VibeWorks address. Say plainly what the plugin sends from then on: for each session, counts and timings only. Prompt count, tool calls by kind, connector kinds, skills, subagents, minutes, model, and the repository name when the folder is a git repository. Never prompts, replies, code, or file names.
3. After they say yes, run the `shell_command` from the reply exactly as given. Never print the token anywhere else, and never put it in a file they might commit.
4. Confirm it is done, and tell them the report arrives after their next reply. They can disconnect any time by deleting that file.
5. Offer one more thing, in one sentence: Claude Code can also send VibeWorks its own usage numbers (tokens, cost, lines of code, commits, tool decisions). If they say yes, merge the `telemetry_settings` from the reply into the `env` block of `~/.claude/settings.json`, keeping every other key in that file as it is. Say that it starts with their next session, that the three content switches stay off, and that removing those keys turns it off.
