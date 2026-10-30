# Privacy policy

*Training Brief Chrome extension · last updated 30 October 2026*

Training Brief exports your own Garmin Connect™ activities as a text brief you can paste into an AI assistant. It runs entirely in your browser. There is no Training Brief server, and the developer never receives any of your data.

## What the extension handles

| Data | Why | Where it's kept |
|---|---|---|
| Your Garmin Connect™ Personal API key, or an access token you paste | To sign in to Garmin's Personal API on your behalf | `chrome.storage.local` in this browser |
| The access token Garmin returns (valid up to 24 hours) | To load your activities without asking for the key each time | `chrome.storage.local` in this browser |
| Your activities (for example sport, date, distance, duration, heart rate, training effect, notes and location fields) | To show the dashboard and build the brief | `chrome.storage.local` if "Remember loaded activities" is on (the default), otherwise `chrome.storage.session`, which Chrome clears when you close the browser |
| Your settings (units, export format, sections, assistant instructions) | To remember your choices | `chrome.storage.local` in this browser |

## Where data goes

- **Garmin only.** The key and the token are sent only to `personal.connectapi.garmin.com`, to get a token and to load your activities. The extension can't contact any other server.
- **Only when you ask.** Activities are loaded when you click to load or refresh them. There's no background sync.
- **Nothing to the developer.** No analytics, no tracking, no crash reporting, no ads and no remote code.
- **The brief goes where you put it.** "Copy for AI" copies the brief to your clipboard, and "Save as file" saves it to your computer. The extension never sends a brief anywhere itself. Once you paste it into an AI assistant or share the file, that service's own privacy policy applies.
- **Your key never goes into a brief.** GPS coordinates and owner or profile fields are left out of briefs by default. You can turn that off in the export options.

Your data is never sold or transferred to third parties. It is used only to provide the extension's single purpose, and never for advertising, creditworthiness or lending decisions. The use of information received from Garmin's API complies with the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq), including its Limited Use requirements.

## How to delete your data

- **Key and token:** Settings → Connect to Garmin → "Forget key" (or "Forget token"), or remove the extension.
- **Loaded activities:** Settings → Preferences → "Delete loaded activities". Or turn off "Remember loaded activities" so they're gone when you close the browser.
- **Everything:** removing the extension from Chrome deletes all of its stored data.

To revoke the key itself, delete it in your Garmin Connect™ account.

## Changes

If this policy changes, the new version is published at this address with a new date. The full history is in the project's [Git repository](https://github.com/choefele/training-brief/commits/main/PRIVACY.md).

## Contact

Questions or concerns: open an issue at [github.com/choefele/training-brief/issues](https://github.com/choefele/training-brief/issues).

---

Garmin and Garmin Connect are trademarks of Garmin Ltd. or its subsidiaries. Training Brief is an independent project and is not affiliated with, sponsored by or endorsed by Garmin.
