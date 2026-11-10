---
name: screens
description: Photograph the app the person is building, on their own machine, and send only the pictures to their VibeWorks project page. Use when they ask to send screenshots, screens or pictures of the app to VibeWorks, or to photograph the app for VibeWorks. To send the whole project, or clips for its video, use the upload skill.
---

Take real screenshots of the app running here and send them to the person's VibeWorks project page. Only the pictures and the words you write for them leave this machine.

1. Find the app. If it is already running, ask for its address if you do not know it (usually http://localhost and a port). If it is not running and the folder has a start script (package.json, Procfile, mix.exs, a README that says how), offer to start it and wait until it answers.
2. Make a folder named `.vibeworks-screens` inside the project folder. Never commit it.
3. Fill the app with sample data before any picture. These pictures go on a public page, so they never show the person's real inbox, contacts, customers, messages or money. Run a local copy against its own local database, not the live one, and add made up entries through the app's own screens, its local API or a seed script: believable work, every name and title starting with "Sample:", no real person's name, email, address or phone number. If the app has one owner account, as a personal tool does, use its local developer way in (a dev key, a local login, a seeded user) rather than the person's own sign in. If the only copy you can reach shows real data, stop and ask the person how to get a copy with sample data.
4. Take three to six screenshots of distinct screens with the browser tool you have (Claude in Chrome, a Playwright or browser MCP, or a short script). Desktop size, about 1280 by 800. Prefer the main screen full of the sample data, a detail or result screen, and the second and third most useful features. Skip settings, account and sign in pages. Save each as PNG or JPG under 2 MB in that folder. Look at every picture before you keep it: no real names, emails or private details anywhere, including menus, sidebars and notifications.
   If you have no browser tool, ask the person to take the screenshots themselves into that folder and tell you what each one shows.
5. For each picture write a title of two to six plain words and one plain sentence saying what a person does on that screen. No hype words. Write `screens.json` in the folder: a list of `{"file": "name.png", "title": "...", "caption": "...", "frame": "browser"}`. Use `"frame": "phone"` for a picture taken at phone width.
6. Show the person the pictures, titles and captions and ask once whether to send them. Say that only these pictures and these words are sent, nothing else from the machine.
7. On yes, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/send-screens.js" --dir .vibeworks-screens --project <slug>`. Use the project's slug from the VibeWorks tool `list_projects` when you know which project this folder is; otherwise pass the repository as owner/name and the server matches it. If `${CLAUDE_PLUGIN_ROOT}` is not set, the script lives in the `scripts` folder of this plugin, beside the `skills` folder this file is in.
8. Read the JSON the script prints and tell the person what happened:
   - `sent`: how many landed and the editor link in `editor_url`. On a draft page they are on the page at once; on a published page they wait as suggestions until the person adds them.
   - `needs_choice`: more than one project has that repository. Ask which one, then run again with its slug.
   - `not_connected`: run the connect skill first, then send again.
   - `no_project`: there is no VibeWorks project for this folder yet. Offer to make one with `create_project`, then send again.
   - `refused` with `rate_limited`: several sends in the last hour. Try again later.
9. Delete the `.vibeworks-screens` folder unless the person wants to keep it.
