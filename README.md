# Fitness

A small personal training and nutrition app. Plain HTML, CSS and vanilla
JavaScript modules. **There is no build step and there never will be.** GitHub
Pages serves this repository root directly, so what is committed is what runs.

Written for a version of me who has forgotten all of this.

- **Live:** https://anand20003831.github.io/fitness-app/
- **Android app:** installed from a signed APK, see [The Android app](#the-android-app)

## Which repo holds what

| Repo | Visibility | Holds |
| --- | --- | --- |
| `fitness-app` | public | This code. Pages serves it from `main`, root. |
| `fitness-data` | **private** | `data.json`. Every weight, set, meal tick and measurement. |
| `Anand20003831.github.io` | public | `.well-known/assetlinks.json` only, so Android trusts the app. |

The app repo is public because free GitHub Pages requires it. Nothing personal
is in it: no weight, no measurements, no name, no email. The starting weight
lives in `data.json` in the private repo, and if it is missing the app asks
rather than carrying a default around in public code.

## Installing it

**Android, as a real app.** Sideload the APK. See [The Android app](#the-android-app).

**Android, as a web app.** Chrome menu, then Add to Home screen.

**Windows.** Open the live URL in Edge or Chrome and click the install icon at
the right-hand end of the address bar.

It works offline once it has loaded successfully once. Sets logged with no
signal are held locally and sync when a connection comes back.

## The token, and replacing it when it expires

The app reads and writes `data.json` in the private repo using a fine-grained
personal access token. It is stored in `localStorage` on each device and is
never committed anywhere.

**The current token expires 1 August 2027.** When it does, sync stops and the
header pill says *Sync error* with "token expired or revoked, add a new one in
Settings". To replace it:

1. github.com, Settings, Developer settings, Personal access tokens,
   Fine-grained tokens, Generate new token.
2. **Repository access:** Only select repositories, and pick `fitness-data`.
3. **Permissions:** Repository permissions, **Contents: Read and write**.
4. Leave everything else alone. **Metadata: Read-only appears by itself and
   cannot be removed.** That is correct, not a mistake.
5. Set an expiry and note the date somewhere.
6. It is shown once. Copy it.
7. In the app: Settings, Replace, paste, then Test connection.

Do this on each device. The token is per device on purpose.

Test connection deliberately asks for `data.json` itself rather than listing
repos, because Contents is the only permission that matters and a repo listing
would pass on Metadata alone.

## The Android app

The app is a Trusted Web Activity: a thin native wrapper that loads the live
site. **Updates to this repo appear in the installed app automatically.** There
is no rebuilding and no reinstalling unless the icon, name or package changes.

Android trusts the wrapper because of Digital Asset Links:
`https://anand20003831.github.io/.well-known/assetlinks.json` names the package
`io.github.anand20003831.fitness` and the SHA-256 fingerprint of the signing
key. Two things are easy to get wrong there:

- It must be served from the **origin root**, not `/fitness-app/`. That is why
  the `Anand20003831.github.io` repo exists.
- That repo needs an empty `.nojekyll` file, because GitHub Pages runs Jekyll
  and Jekyll refuses to publish folders whose name starts with a dot. Without
  it the file is silently never served.

The signing keystore is **not in any repo**. It sits in `android-signing/`
alongside this project on the PC, with its password in a text file next to it.
If it is lost, a rebuilt app counts as a different app to Android: it cannot
install over the existing one, and the fingerprint in `assetlinks.json` stops
matching, so the app falls back to showing a browser URL bar. Recovering means
a new key, a new fingerprint published, uninstall and reinstall.

## The calendar, if you ever want it

Optional. The app is fully usable without it and fails quietly to "calendar not
connected".

1. console.cloud.google.com, create a project.
2. APIs and Services, Library, enable **Google Calendar API**.
3. OAuth consent screen: External, publishing status **Testing**, and add your
   own email as the only test user.
4. Credentials, Create credentials, OAuth client ID, **Web application**.
5. Authorised JavaScript origins, add exactly:

   ```
   https://anand20003831.github.io
   ```

   **No path and no trailing slash.** Not `.../fitness-app/`, not a trailing
   `/`. This is the single most common thing people get wrong and the error it
   produces does not tell you that is the problem.
6. Copy the client ID into the app: Settings, Google OAuth client ID.

## Changing the plan

**Everything about the plan lives in `plan.js`.** Meals with their calories,
protein, ingredients and method; the five sessions and every exercise, set
count, rep range and coaching note; which session falls on which day; the
shopping list; rest times; the daily targets. Edit that one file, commit, push,
and the whole app follows. Nothing else needs touching.

Saturday is a higher day and works by the same mechanism: `TARGETS.saturdayKcal`
and `saturdayProtein`, plus `SATURDAY_MEAL`, which is a real fifth meal shown
only on Saturdays so the day still adds up exactly.

## How Claude reads the data

```bash
git clone https://github.com/Anand20003831/fitness-data.git
```

Then read `data.json`. Day keys are local `YYYY-MM-DD` dates in Europe/London,
never UTC.

```
days      weight, bedTime, wakeTime, meal ticks, walkjog, notes
workouts  sessionId and every set as { kg, reps, done }
measures  waist and shoulders
settings  startWeight, goalDate, shopping list state
```

Records carry `updatedAt`, and entries in `days` also carry `fieldsUpdatedAt`
per field, so a weight entered on one device and a meal ticked on another
merge without either being lost.

## Running it locally

No build, no install, no npm. ES modules will not load over `file://`, so it
needs a real HTTP origin:

```bash
powershell -ExecutionPolicy Bypass -File serve.ps1
```

Then open http://localhost:8080. Ctrl+C stops it. That script has no
dependencies; it is about sixty lines of PowerShell.

`tools/make-icons.ps1` regenerates the PNGs in `icons/`. Its output is
committed, so nothing has to be built to serve the site.

## The files

```
index.html              markup and the tab bar
styles.css              all styling, dark by default, light via prefers-color-scheme
app.js                  routing and rendering
plan.js                 the whole plan, the only file worth editing
store.js                localStorage, London date handling, merge logic
sync.js                 GitHub contents API
report.js               the Sunday report builder
calendar.js             Google Identity Services
sw.js                   offline cache. Bump CACHE when files change.
manifest.webmanifest    PWA manifest
icons/                  192, 512 and a maskable 512
serve.ps1               local dev server
tools/make-icons.ps1    redraws the icons
```
