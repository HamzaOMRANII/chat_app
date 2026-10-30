# H_CHAT app

The user app for H_CHAT: one React 19 + Vite + TypeScript + Tailwind 4 codebase that builds both the web app
(`chat.omranisystems.com`) and the Android APK (Capacitor). It talks to `chat_backend` over `/api` and
`/socket.io`. Messages, files and calls are encrypted **here, on the device** (libsodium, `src/lib/e2e.ts`).
Full system documentation: `/projects/chat_documentation/`. When something breaks:
`/projects/chat_backend/docs/TROUBLESHOOTING.md`.

## Start in 5 minutes

```bash
npm ci
npm run dev      # http://localhost:5173, proxies /api and /socket.io to the backend on 127.0.0.1:12000
npm run check    # code checker + types + tests: run before every commit
```

Run `chat_backend` (`npm run dev`) at the same time, or point the proxy in `vite.config.ts` elsewhere.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Web app with live reload |
| `npm test` | All tests (jsdom + Testing Library); one test: `npx vitest run -t "secure-code"` |
| `npm run lint` / `npm run format` | Code checker / house style (Biome) |
| `npm run typecheck` | TypeScript only |
| `npm run check` | lint + typecheck + tests |
| `npm run release` | **The way to ship**: tests, version bump, web build (live at once) + signed APK |

## Where things live

```
src/
  main.tsx             entry
  app/App.tsx          the screen router: which page shows for which state (signed out, code, chats, …)
  app/types.ts         shapes of the API answers (User, Chat, Message, …)
  app/App.test.tsx     the app tested end to end with a fake server (routes map) and fake socket
  pages/               one file per screen: LoginPage, CodePage (email code + hidden secure code),
                       ContactsPage (home), ChatPage (stored chats), LivePage, GroupPage, SettingsPage, …
  components/          reusable pieces: Button, TextField, Screen (AuthScreen/Card/Notice), sheets, CallScreen
  lib/
    api.ts             every HTTP call goes through api(path, { method, body }); errors become ApiError
    e2e.ts             encryption (keys, messages, files, safety codes); covered by e2e.test.ts
    chats.ts live.ts groups.ts files.ts exports.ts contacts.ts   feature logic used by the pages
    calls.ts           WebRTC calls (devices: selectMic / selectCamera / selectOutput)
    notifications.ts   Web Push + Firebase (Android)
    native.ts platform.ts   what differs on Android (Capacitor plugins, server URL, token storage)
  styles.css           design tokens (colours, fonts, radii) as Tailwind @theme
android/               Capacitor Android project (generated; plugins, icons, signing config)
scripts/               release.mjs (ship), build-apk.mjs (signed APK), android-assets.sh (icons)
```

## Common changes

**Change a screen.** Find it in `src/pages/` (the visible title is a good search term). Styling is Tailwind
classes using the tokens in `styles.css` (`text-ink`, `bg-panel`, `border-line`, …): reuse them, don't add colours.

**Call a new API route.** `await api<Answer>("/api/thing", { method: "PUT", body })`. Show `err.message` from
an `ApiError` to the user: the backend writes those messages for people.

**Add a setting.** Copy a section component (`CallSettings.tsx`, `SecureCodeSettings.tsx`) and add it to
`pages/SettingsPage.tsx`.

**Test it.** In `App.test.tsx`, answer the new route in `routes["/api/…"]`, render `<App />`, act like a user
(`fireEvent`), and `await screen.findBy…` anything that appears after a request (never `getBy…` for that:
the test becomes flaky on a busy machine).

## Rules

- **Every change is released to the web and the APK together:** `npm run release` (or
  `bash /projects/hchat-deploy.sh` for server + backoffice + app). Phones then show "Update available".
- Never send message, file or live-chat content to the server unencrypted; use `lib/e2e.ts`.
- Firebase files (`google-services.json`, `*firebase-adminsdk*.json`) and `android/keystore.properties` stay
  out of git.

## Android APK

Never published to a store. `npm run release` builds a signed APK from the `version` in `package.json` and
publishes it to `/projects/mobile_builds/h_chat` (`h_chat-<version>.apk`, `h_chat.apk`, `latest.json`).

- Needs Java 21 and the Android SDK in `/opt/android-sdk`.
- Signing: `android/keystore.properties` (not in git) points to the key in `/root/.chat-keystore/`.
  **Every update must be signed with this key** (a copy is in Omrani Pass → "Apps builds keys").
- Icons and splash screens: `scripts/android-assets.sh` regenerates them from `resources/logo-mark.svg`.
