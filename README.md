# H_CHAT app

The user app for H_CHAT: one React 19 + Vite + TypeScript codebase that builds both the web app
(`chat.omranisystems.com`) and the Android APK (Capacitor). Design tokens live in `src/styles.css`.

```bash
npm ci
npm run dev      # proxies /api and /socket.io to the backend on 127.0.0.1:12000
npm test
npm run build    # web app -> dist/ (served by nginx)
```

## Android APK

Never published to a store. `npm run build:apk -- --notes "What changed"` builds a signed release from the
`version` in `package.json` and publishes it to `/projects/mobile_builds` (`h_chat-<version>.apk`,
`h_chat.apk`, `latest.json`). Bump the version first.

- Needs Java 21 and the Android SDK in `/opt/android-sdk`.
- Signing: `android/keystore.properties` (not in git) points to the key in `/root/.chat-keystore/`.
  **Every update must be signed with this key. Keep the backup safe.**
- Icons and splash screens: `scripts/android-assets.sh` regenerates them from `resources/logo-mark.svg`.

Deploy the web app: `/projects/deploy.sh chat_app`.
