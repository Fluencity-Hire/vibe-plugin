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

## Reads, if you turn them on

When VibeWorks offers reads as you connect and you say yes, the plugin also reads each session for the behaviors behind your score. When a session with three or more prompts ends, it runs one read through your own Claude Code in non-interactive mode: the transcript goes to Anthropic under your account, and VibeWorks receives which of the public codebook's behaviors you showed, each with a note under 25 words, plus one short note about the session that Claude writes. Never a quote, a name, code, or a file name. After your next reply, it reads the last month of sessions on your machine in the background, once. Claude Code keeps session files for about 30 days (`cleanupPeriodDays` in `~/.claude/settings.json`); raise it to keep older sessions readable. Each read costs tokens of your plan. A session read once is never read again.

Nothing is sent until you connect. Delete `~/.claude/vibeworks/token.json` to stop.

## Screenshots, when you ask

Say "send screenshots to VibeWorks" or run `/vibeworks:screens`. Claude Code photographs the app running on your machine with whatever browser tool it has, writes a title and a line for each picture, shows you the list, and sends only those pictures and words to your project page. They land on a draft page at once and wait as suggestions on a published page. Nothing else from your machine goes with them.

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
4. `/vibeworks:screens` to send real screenshots of the app to your project page.

## Test the reporter

```
node --test "plugin/vibeworks/scripts/*.test.js"
```
