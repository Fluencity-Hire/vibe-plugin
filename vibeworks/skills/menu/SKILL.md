---
name: menu
description: Show the Hey VibeWorks menu, a numbered list of what the person can do with VibeWorks from here. Use when they say Hey VibeWorks and nothing else, or ask what VibeWorks can do. When they already said what they want, such as upload this project, do that instead.
---

Call the VibeWorks tool `hey_vibeworks` with `platform` set to `claude_code`, `plugin_installed` set to `true`, and `has_repository` set to whether the current folder is inside a git repository. Show the greeting, the standing lines, and the options as a numbered list, one line each. Ask which one they want and call nothing else until they choose. If the reply carries `plugin_offer`, end with its `ask` as the closing question instead, with its `sends` line under it; on yes, follow the connect skill. When they pick sending or updating a project, follow the upload skill: it writes the page from the folder, films the app on this machine with sample data, and sends it all after one yes, so ask for no live link and no test account. If the VibeWorks server is not signed in yet, tell them to run `/mcp`, pick VibeWorks, and sign in.
