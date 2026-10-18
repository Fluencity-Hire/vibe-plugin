# VibeWorks plugins for Claude Code

Install:

```
claude plugin marketplace add Fluencity-Hire/vibe-plugin
claude plugin install vibeworks@vibeworks
```

Then say `Hey VibeWorks` in Claude Code, or run `/vibeworks:connect` to start sending session counts to your VibeWorks profile.

The `vibeworks` plugin adds the VibeWorks connector, a session reporter that sends counts and timings only (never prompts, code, or file names), and the `/vibeworks:menu` and `/vibeworks:connect` skills. See `vibeworks/README.md` for what it sends and how to disconnect.

This repo mirrors the `plugin/` folder of the VibeWorks codebase. Changes land there first.
