// Mirrors /shared/app_content.json — keep both in sync when text changes.
export const APP_CONTENT = {
  appName: "Offrs' Pers Files",
  tagline: "Every Imp Docu. Always on you.",

  about: `Offrs' Pers Files keeps every Imp Pers Docu from an officer's career in one organized, searchable place — CORO, IPFT and RET records, Course/Cadre files, certificates, financial and misc docs — always on your device, always with you.

No sign-up required. Your Docus stay fully offline — add, search, and share directly to WhatsApp or any app in seconds. An optional phone/email PIN-recovery feature is the only part of the app that ever uses the internet.

Crafted by Ijaj Ahmed Shajin.`,

  disclaimer: `Offrs' Pers Files is an independent, personally developed tool. It is not affiliated with, endorsed by, or officially connected to Bangladesh Army or any government/defence organization. It is provided "as is" for Pers record-keeping convenience only.

The developer accepts no liability for data loss, file corruption, device compromise, or any consequence arising from use of this app. Users are solely responsible for backing up their data and for handling official/sensitive Docus in accordance with applicable rules, regulations, and security protocols. Use of this app is entirely at the user's own discretion and risk.`,

  privacy: `Offrs' Pers Files stores all your Docus and data exclusively on your own device. There is no server, no cloud sync, and no account required — the app works fully offline.

The only exception: if you choose to add a recovery phone or email (entirely optional, skippable), that contact is verified and stored via Firebase Authentication (a Google service) solely so you can reset a forgotten PIN — sending a one-time code by SMS or a sign-in link by email. It is never linked to your Docus. Skip it and your only recovery path is restoring from your own encrypted backup file.

Nothing you add is ever transmitted anywhere unless you personally choose to share/export a file or opt in to phone/email recovery. Uninstalling the app permanently erases all locally stored data, so take a manual backup beforehand if needed.`,

  whyThisApp: `A file browser just shows you whatever files you dropped somewhere. Offrs' Pers Files is built specifically around how a Pers file actually works:

• Encrypted, not just "on the phone" — every Docu is encrypted at rest. A plain file browser leaves everything readable to any app or anyone who picks up your phone.

• Pre-built for career filing — CORO, IPFT, RET, Course/Cadre, Fin and Banking and more come already structured the way you'd actually file them, with Year/CORO-type/Bi-Annual sub-folders — not one flat pile you re-sort every time.

• Search that reaches inside a Docu, not just its name — CORO number, cert issuer, tags, notes are all searchable, so you find a Docu by what it's about, not what you happened to name the file.

• Timeline — every Docu across every category, laid out by date. A file browser has no concept of "when this actually happened."

• Keep Track — a ledger + a Pers Docu checklist with re-check reminders, so you know what's due, not just what's stored.

• One-tap share/print — straight to WhatsApp, or a print-ready Dossier PDF from several Docus at once. A file browser makes you attach files one by one.

• No account, no cloud — nothing leaves your device unless you choose to share it or opt into phone/email recovery.`,

  howToUse: `Home — tap any category tile to open it. Categories with sub-folders (CORO, IPFT, RET, Course/Cadre, Misc, Fin and Banking) show a folder list first; tap a folder to get to its upload form and Docu grid. Use the search icon (top-right) to search across every Docu, or Quick Add to jump straight to any category, including creating a new one.

Adding a Docu — inside any category/folder, tap "Choose file" (any file type) or "Scan" (camera), fill in the Type, Dt, Tags and Notes, then "Save Docu". Every Docu is named Category - Type - Dt automatically, so it's identifiable at a glance instead of a plain filename. Every entry gets a proper Day/Month/Year Dt.

Managing Docus — tap a Docu to open it. Tap the Share icon on a thumbnail to send it straight out, or the Delete icon to remove it. Use "Select" (top-right of the Docu grid) to pick several at once for Bundle Share (zip) or a print-ready Dossier PDF (images only).

Timeline — every Docu you've added, newest first, grouped by year. Tap any entry to jump straight to that Docu's own category/folder.

Track — "Ledger" logs recurring entries (Allce, fees, etc.) with reminders on your own schedule; "Checklist" is a Pers Docu checklist you tick off, each with its own re-check period.

Backup — export everything to one password-protected file (the only way to move Docus to a new phone/computer — there's no cloud sync), or import one back in.

Settings — switch Light/Dark, and read About/Disclaimer/Privacy any time.

On iPhone: Safari's Share button → "Add to Home Screen" installs this like a real app icon, works fully offline after the first load.`,

  credit: "Crafted by Ijaj Ahmed Shajin",
};
