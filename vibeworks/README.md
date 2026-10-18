# VibeWorks for Claude Code

One plugin that adds the VibeWorks connector to Claude Code, reports each session's counts and timings to your VibeWorks profile, and gives you two commands.

## What it sends

After every reply, and once more when a session ends, the plugin reads the session's transcript file on your machine and sends VibeWorks only:

- when the session started and the last time it was active, and the minutes you were actually working
- how many prompts you typed and how many were slash commands
- how many tool calls Claude made, by kind: reading, editing, shell, web, skill, subagent, connector, planning, questions
- which kinds of connectors were used (code, chat, documents, and so on), never their names
- how many skills and subagents ran, and how often the context was compacted
- the model, the Claude Code version, the permission mode
- the repository as owner/name when the folder is a GitHub repository, and a hash of the folder path

It never sends prompts, replies, code, file names, or anything you or Claude wrote.

Nothing is sent until you connect. Delete `~/.claude/vibeworks/token.json` to stop.

## Install

From a marketplace that lists it:

```
claude plugin marketplace add Fluencity-Hire/vibe-plugin
claude plugin install vibeworks@vibeworks
```

Or straight from this folder while developing:

```
claude --plugin-dir ./plugin/vibeworks
```

Then, inside Claude Code:

1. `/mcp`, pick VibeWorks, and sign in.
2. `/vibeworks:connect` and say yes when it shows you the file it will write.
3. `/vibeworks:menu` any time to see what else you can do.

## Test the reporter

```
node --test plugin/vibeworks/scripts
```
