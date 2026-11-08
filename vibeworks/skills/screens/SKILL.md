---
name: screens
description: Photograph the app the person is building, on their own machine, and send the pictures to their VibeWorks project page. Use when they ask to send screenshots, screens or pictures of the app to VibeWorks, or to photograph the app for VibeWorks.
---

Take real screenshots of the app running here and send them to the person's VibeWorks project page. Only the pictures and the words you write for them leave this machine.

1. Find the app. If it is already running, ask for its address if you do not know it (usually http://localhost and a port). If it is not running and the folder has a start script (package.json, Procfile, mix.exs, a README that says how), offer to start it and wait until it answers.
2. Make a folder named `.vibeworks-screens` inside the project folder. Never commit it.
3. Take three to six screenshots of distinct screens with the browser tool you have (Claude in Chrome, a Playwright or browser MCP, or a short script). Desktop size, about 1440 by 900. Sign in first if the app needs it; the person is already signed in on this machine, or will tell you how. Prefer the main screen with real data in it, a detail or result screen, and the second and third most useful features. Skip settings, account and sign in pages. Save each as PNG or JPG under 2 MB in that folder.
   If you have no browser tool, ask the person to take the screenshots themselves into that folder and tell you what each one shows.
4. For each picture write a title of two to six plain words and one plain sentence saying what a person does on that screen. No hype words. Write `screens.json` in the folder: a list of `{"file": "name.png", "title": "...", "caption": "...", "frame": "browser"}`. Use `"frame": "phone"` for a picture taken at phone width.
5. Show the person the list of files, titles and captions and ask once whether to send them. Say that only these pictures and these words are sent, nothing else from the machine.
6. On yes, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/send-screens.js" --dir .vibeworks-screens --project <slug>`. Use the project's slug from the VibeWorks tool `list_projects` when you know which project this folder is; otherwise pass the repository as owner/name and the server matches it. If `${CLAUDE_PLUGIN_ROOT}` is not set, the script lives in the `scripts` folder of this plugin, beside the `skills` folder this file is in.
7. Read the JSON the script prints and tell the person what happened:
   - `sent`: how many landed and the editor link in `editor_url`. On a draft page they are on the page at once; on a published page they wait as suggestions until the person adds them.
   - `needs_choice`: more than one project has that repository. Ask which one, then run again with its slug.
   - `not_connected`: run the connect skill first, then send again.
   - `no_project`: there is no VibeWorks project for this folder yet. Offer to make one with `create_project`, then send again.
   - `refused` with `rate_limited`: several sends in the last hour. Try again later.
8. Delete the `.vibeworks-screens` folder unless the person wants to keep it.
