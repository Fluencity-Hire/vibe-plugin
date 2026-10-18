---
name: menu
description: Show the Hey VibeWorks menu, a numbered list of what the person can do with VibeWorks from here. Use when they say Hey VibeWorks or ask what VibeWorks can do.
---

Call the VibeWorks tool `hey_vibeworks` with `platform` set to `claude_code` and `has_repository` set to whether the current folder is inside a git repository. Show the greeting, the standing lines, and the options as a numbered list, one line each. Ask which one they want and call nothing else until they choose. If the VibeWorks server is not signed in yet, tell them to run `/mcp`, pick VibeWorks, and sign in.
