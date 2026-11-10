---
name: upload
description: "Put the project in this folder on the person's VibeWorks in one go: its page, how it was built, and short clips of the app in use that become its video. Use when they say upload, send, add, save, put or publish this (project) to VibeWorks or to my VibeWorks, with or without Hey VibeWorks in front, ask to update this project in VibeWorks, or pick sending or updating a project from the Hey VibeWorks menu."
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/film.js *), Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/send-screens.js *), Write(.vibeworks-film/**), mcp__plugin_vibeworks_vibeworks__list_projects, mcp__plugin_vibeworks_vibeworks__create_project, mcp__plugin_vibeworks_vibeworks__update_project, mcp__plugin_vibeworks_vibeworks__save_build_story
---

The person asks once and says yes once. Everything else is your work: read the project, write its page, film the app on this machine with sample data, and send it all. Find out what you can from the folder instead of asking. Never ask for a password, and never use the person's own sign in. While this skill runs it replaces what the VibeWorks tools say about asking for a live link, a test account, or a yes for each field: the one question in step 4 covers them all.

VibeWorks makes a short video for the page from what you send. A video of real clicks, typing and results is what makes the page worth a look, so the filming in step 3 is the heart of this skill. Still pictures are the fallback, not the goal.

Start with one line to the person: you will read the project, run it here with sample data and film it, and Claude Code may ask them to approve a few commands along the way.

If the VibeWorks tools (`list_projects`, `create_project`) are not available, tell the person to run `/mcp`, pick the VibeWorks server (it may be listed as `plugin:vibeworks:vibeworks`) and sign in, then carry on.

## 1. Find the page

Call `list_projects`. Match this folder to a page by its git remote (owner/name) first, then by name.

- One page matches by repository: you will update it, and say so in step 4.
- No page matches: you will make a new one.
- More than one could be it, or the only match is by a similar name: ask which. This is the only question you may ask before step 4.

## 2. Write the page from the project

Read the README, the manifest (package.json and the like), the main screens and routes, and the recent commits. Draft, in plain words with no hype:

- `name`, `one_liner` (one sentence, what it does), `description` (two or three sentences, what it does and who it is for)
- `kind`: app, workflow, skill, agent or other
- `why`: only when the README, commits or the person's words say why it was built
- `tools`: only what you saw in the code or config
- `steps`: how it works now, in order, up to 8
- `live_url`: only when the repository says where it runs (README, deploy config) and anyone can open it. Leave it out for an app behind a sign in unless the person asks. Do not ask for it.
- `repository`: the facts `create_project` describes, read with the git commands it gives. If the clone is shallow (`git rev-parse --is-shallow-repository` says true), leave the counts out; they would be wrong.

Leave out anything you would have to guess. A folder with no README often keeps its story in CLAUDE.md or a docs file. When the folder holds more than one app, the page is for the one the person means; if that is not plain, it is the one question you may ask in step 1. When the folder has a git repository, also draft what `save_build_story` asks for, as its own description says, so the person sees it before anything is sent.

## 3. Film the app here, on sample data

Skip this step when the project has no screens (a skill, an agent, a command line tool). Write an `example` for the page instead: one thing a person asks it and what comes back.

**First find where the app keeps its data.** Read its environment files and config. The clips go on a public page, and filming also writes sample entries, so this decides everything:

- Its data lives on this machine (a local database, a file, an emulator, a local dev server's own store): good. Carry on.
- It points at a hosted database or service (Supabase, Firebase, a cloud database, any address that is not this machine): that is live data. Do not film it and do not write to it. See if the project has a local mode (a local emulator, a compose file, a seed or test setup) and use that. If it has none, use the fallback at the end of this step.
- You cannot tell: stop and ask the person where the data lives.

**Run a local copy.** Start the app in the background the way the folder says (package.json scripts, README, Procfile, compose file) and wait until it answers. A copy that is already running locally is fine only when its data passed the check above. If the app needs a local settings file and the folder's docs say how to make one with made up values, make it that way; never copy a real key into it and never overwrite one that exists. If the app is not up after three tries or about five minutes, use the fallback.

**Fill it with sample data.** Film only a copy whose every visible entry you made or know is made up. Write the seeding as one script, `.vibeworks-film/seed.sh`, and run it once, so the person approves one command. Add enough believable entries, through the app's local API or a seed command, for two takes of every shot: fifteen to twenty is usual. Start each name or title with "Sample:". No real person's name, email, address or phone number. Add nothing that sends an email or a text, or charges a card. For an app with one owner account, get in through its local developer way in (a dev key, a local login, a seeded user), which the plan below can carry.

**Look before you plan.** Write `.vibeworks-film/plan.json` with the `base` and the way in (below) and no shots yet, then look at each page you mean to film:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/film.js --look --path / --plan .vibeworks-film/plan.json --out .vibeworks-film
```

It prints the buttons, fields and headings on that page and saves a picture of it (`picture`). Read the picture. Plan from what is there, not from the source alone. Parts of a page that need a connected account (a calendar, an inbox) stay empty on sample data: start that shot with a `scroll` to the part that has data, which puts its target in the middle of the screen.

**Plan three to six shots.** One shot per feature worth showing, in the order a person meets them: the way in first, the payoff last. Each shot is one action with a result the viewer can see: adding an entry, asking a question and getting the answer, running a search, opening a detail, dragging a card. Leave out sign in, settings, account and empty pages.

- A clip is as long as its steps, up to seven seconds: about a second for each click, the time typing takes, and a second and a half held on the result. Give each shot two to four steps that each change the screen. One click alone makes a clip too short to show anything. With many steps, the first ones fall off the front.
- End every shot on `wait` `for` something that shows the result. A shot that ends any other way gets a slow scroll down the page added, and its clip ends wherever that stops.
- Shots run in order on the same data and each one changes it. Plan so one shot does not empty what the next one needs. If takes leave the data messy, reset the local data, seed again, and film everything once more.

Add the shots to `.vibeworks-film/plan.json`:

```json
{
  "base": "http://localhost:3000",
  "headers": { "Authorization": "Bearer local-dev-key" },
  "before": { "path": "/login", "steps": [{ "do": "click", "target": { "role": "button", "name": "Use demo account" } }] },
  "shots": [
    {
      "name": "add-task",
      "title": "Add a task",
      "caption": "Type a task and it joins today's list.",
      "path": "/",
      "steps": [
        { "do": "type", "target": { "label": "New task" }, "text": "Sample: Book kickoff calls" },
        { "do": "click", "target": { "role": "button", "name": "Add task" } },
        { "do": "wait", "for": { "text": "Sample: Book kickoff calls" } }
      ]
    }
  ]
}
```

- `headers` (sent only to the app's own address) and `before` are optional ways in. `before` runs once, unfilmed, and its sign in carries into every shot.
- `name`: lowercase letters, numbers and dashes. `title`: two to six plain words. `caption`: one plain sentence saying what a person does on that screen. `path` starts with `/`.
- Steps:
  - `click`, `hover`: a `target`.
  - `type`: a `target` and `text`, up to 60 characters. It clears the field first.
  - `press`: a `key` such as `Enter`, sent to whatever has focus.
  - `select`: a `target` that is a plain dropdown, and `option`, the words of the choice.
  - `drag`: `from` and `to`, both targets.
  - `scroll`: a `target` to bring into view, or `by` in pixels.
  - `wait`: `ms`, or `for` a target to appear, up to 15 seconds (`"limit_ms"` raises it to 30). End a shot on `wait` `for` the answer when the app takes time to reply: the clip then ends on the answer arriving.
  - `goto`: a `path`.
- A target is one of `role` with `name`, `label`, `placeholder`, `text`, `testid` or `css`. Prefer the first four, using the words on the screen. They match part of the words and the first match wins, so add `"exact": true`, `"nth": 1` (counted from 0) or `"within": "<css>"` when several things match. `within` also takes `:has-text("words")`, to pick the row or card that holds those words: `"within": ".row:has-text(\"Sample: Book kickoff calls\")"`.
- A drag shows the pointer travel and the card land; the card is not drawn in flight. That is how it films, not a fault to retake for.
- Up to 12 steps a shot. A shot with no steps glides down the page, which suits a dashboard. Links that open a new tab are not filmed.

**Film it.** Run:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/film.js --plan .vibeworks-film/plan.json --out .vibeworks-film
```

If `${CLAUDE_PLUGIN_ROOT}` is not set, the script is in the `scripts` folder of this plugin, beside the `skills` folder this file is in. Read the JSON it prints:

- `filmed`: every shot it lists is done, each with the pictures to check: `opens_on` (the clip's first frame), `still` (its result) and `phone` (the same screen at phone width, which is sent too). `missing` names any shot of the plan that is not done.
- `needs_setup`: run the script once with only `--setup` (allow it ten minutes), then film again. It installs a small browser driver for filming and uses the Chrome already on the machine. Tell the person in one line that you are doing this. If it says `needs_setup` again, use the fallback.
- `step_failed`: `failed` lists each shot that could not be filmed, the step, and what is on the page (`on_page`). The other shots are kept. Fix each failed shot from what is really there and film it again with `--shot <name>`. A failure in `before` means the way in is wrong; fix it and film everything again.
- `failed`: the plan could not be read; the message says why.

Before filming a shot again, remove what its last take added or type a different entry, so the same sample line does not show twice.

**Look at what you filmed.** Read the `contact` picture: one row per shot, from the frame its clip opens on to its final still, then its phone picture. Then read each shot's `opens_on`, `still` and `phone` at full size. Check every picture for three things:

1. The clip opens on a screen with something on it, not on empty sections, and its still shows the result of the shot. No spinner, error, empty state or sign in form anywhere.
2. Every name, email, message and number is sample data you made. Names the app prints itself count too: the owner's name in an activity log, a company in a menu. Keep them out of frame, or drop the shot. If anything real shows anywhere, do not send that shot.
3. The shot earns its place: it shows a different feature from the others, and something visibly changes in it.

Film again any shot that falls short, at most twice, then drop a shot that will not come right. Two good shots beat five weak ones.

**The fallback, when the app cannot be filmed here** (live data only, secrets you cannot stand in for, it will not start, or filming will not set up): do not block the upload. Send the page without clips, and say so in step 4. When the app runs on the web with no sign in, send its `live_url` and VibeWorks photographs it. When it sits behind a sign in, tell the person they can add a test account or screenshots on the page later.

## 4. Ask once

Show the person, briefly:

- which page: a new one, or the update to the page you matched. If that page is published, say its new words show to visitors right away.
- the page: name, one line, description, kind, tools, steps, and `why` or `example` if you wrote one
- the build story's brief and notes, when there is one
- the shots: each title and caption, and the path of the contact picture so they can open it. If there are none, say why and what the video will be made from instead.
- what leaves this machine: these words, the build story above, these pictures and short recordings of the sample data, and the repository's counts and dates. No code and no file contents.

Ask one question: send this to VibeWorks? Change what they ask you to change. Send nothing until they say yes.

## 5. Send

1. Call `update_project` for an existing page or `create_project` for a new one, with what you drafted, `platform` set to `claude-code`, and the `repository` facts. If the reply says `needs_choice`, ask which page and call again.
2. When the folder has a git repository, call `save_build_story` with what you showed.
3. Send the film with the `screens_upload` the reply in step 1 carried. Its `pass` goes on the command and nowhere else: never into a file, and do not repeat it in your messages.

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/send-screens.js --dir .vibeworks-film --url <url> --pass <pass> --video
```

If the reply in step 1 has no `screens_upload`, say the page is saved without clips and stop there. Otherwise read the JSON the script prints:

- `sent`: `clips` says how many clips landed. `video` is `started` (a video is being made now), `waiting` (several videos were made this hour; they can ask for one on the page later) or `none`.
- `refused` with `pass_expired`: the pass is over thirty minutes old. Call `update_project` with the project and `platform` `claude-code` to get a new one, then send again.
- `refused` with `video_rendering`: a video is being made from the shots already on the page. Tell the person to send again when it is done.
- `refused` with `rate_limited`: several sends in the last hour. Try later.

## 6. Report and tidy

Tell the person in a few lines: the page is saved as a draft only they can see (or updated), with its link (`edit_url`); how many clips landed; and that the video shows up on that page in about 15 to 30 minutes, where they can keep it, ask for changes, and publish. Then ask the one question the reply's `follow_up` says to ask.

Stop any local server you started, and remove the sample entries if the copy was one the person already had running. Remove the film folder unless the person wants to keep it:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/film.js --clean --out .vibeworks-film
```
