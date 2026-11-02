# Training Brief

Chrome extension that exports your Garmin Connect™ activities as an AI-ready brief for ChatGPT, Claude or any assistant. Runs locally with your own Personal API key. Not affiliated with Garmin.

> **Garmin and Garmin Connect are trademarks of Garmin Ltd. or its subsidiaries.** Training Brief is an independent project and is not affiliated with, sponsored by or endorsed by Garmin.
>
> **Not medical advice.** Training Brief only reformats your data. Whatever an AI assistant makes of it is not medical or professional advice.

## What it does

1. You paste your **own Garmin Connect™ Personal API key** once. It stays on your device.
2. On request, Training Brief loads your activities straight from Garmin's Personal API. There is no server in between and no background sync.
3. Pick a preset (**Coach review**, **Race prep** or **One activity**), a period and a sport, then click **Copy for AI** and paste the brief into a chat.

The brief comes in Markdown (default), JSON or CSV and can contain:

- instructions for the assistant (editable; a coach prompt by default),
- "About this data": period, filters, units and Garmin's training-effect scale,
- a summary by sport, including the last 7 days against the 4-week average,
- weekly totals (weeks start on Monday),
- the activity list, oldest first, with about 20 core fields or every field the API returned.

GPS coordinates and owner or profile fields are left out by default. The side panel shows the size and a token estimate, and warns when a brief is probably too long to paste.

The **dashboard** shows KPIs, weekly volume, sport mix, a consistency heatmap, the running trend, training effect, bests and a sortable activity table. Until you connect, it shows clearly labeled sample data.

## Your key and your data

- You need your **own** Personal API key from Garmin Connect™. Garmin's terms say the key is personal: use it only in tools you use for yourself, and don't share it.
- The key and the 24-hour access token are kept in `chrome.storage.local` on your device and are sent only to `personal.connectapi.garmin.com`. They never go into an export, a log or anything that reaches an AI.
- Activities are loaded only when you ask, one page at a time. "Remember loaded activities" decides whether they survive closing the browser.
- The extension asks only for `storage`, `sidePanel`, `contextMenus` and access to `https://personal.connectapi.garmin.com/*`. It loads no remote code or fonts.

## Use it

- **Toolbar icon:** opens the side panel (or press <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd>).
- **Right-click the icon:** "Open dashboard" and "Open side panel".
- **Dashboard:** <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>D</kbd>, or the link in the side panel. It opens on first install, and an open dashboard tab is reused.
- **Settings:** the gear in the side panel, or the extension's Options. Paste your key there, or an access token instead (a JWT is recognized automatically; it lasts up to 24 hours).

## Develop

Needs Node.js 20 or later.

```bash
npm install
npm run check      # type-check, test core, build the extension
```

Then open `chrome://extensions`, turn on Developer mode, choose **Load unpacked** and select `packages/extension/dist`. `npm run watch` rebuilds on change.

`npm run preview -w @training-brief/extension` serves the pages at http://localhost:8642 in a normal tab, with `chrome.*` stubbed and sample data. It's for UI work only; it can't reach Garmin.

`npm run package` writes a zip for the Chrome Web Store. `npm run store-assets` renders the store screenshots and promo tiles from `store/templates` into `store/` (needs Google Chrome; set `CHROME` to use another path). `npm run icons` re-renders the PNG icons from `packages/extension/icon.svg`.

### Layout

| Path | What's in it |
|---|---|
| `packages/core` | Garmin Personal API client, record normalization, filters, summaries and the Markdown/JSON/CSV export builders. No browser-extension dependencies, so a later MCP server (`training-brief-mcp`) can reuse it. Tests use Vitest. |
| `packages/extension` | Manifest V3 extension: service worker, side panel, dashboard and settings pages. Plain TypeScript, bundled with esbuild. |

### Garmin Personal API notes

- Token: `POST /personalapitoken-service/personal-api/personal-api-key/token` with `Authorization: ApiKey <key>`. The response format isn't documented, so the client accepts a bare string or JSON with `access_token`, `accessToken`, `token` or `value`. Expiry comes from a JWT's `exp`, otherwise about 23 hours.
- Activities: `GET /activitylist-service/activities/search/activities?start=…&limit=100&startDate=…&endDate=…` with a bearer token, paged until a short page.
- Don't send `Accept: application/json`: the token endpoint answered HTTP 406 to it.

## Privacy

See [PRIVACY.md](PRIVACY.md).

## License

[MIT](LICENSE) © Claus Höfele
