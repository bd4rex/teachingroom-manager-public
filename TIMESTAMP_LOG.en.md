# Timestamp Log

[中文](./TIMESTAMP_LOG.md)

This file records only public-repository release and handoff events. It excludes private-repository history, real deployment addresses, local machine paths, account passwords, and internal business data.

## Current Repository

| Field | Value |
| --- | --- |
| Repository | `https://github.com/bd4rex/teachingroom-manager-public.git` |
| Default branch | `main` |
| Visibility | `public` |
| Data policy | Commit synthetic initialization data only; exclude databases, backups, uploads, exports, and runtime secrets |

## Entries

### 2026-07-27 10:56:45 CST

- Event: Reordered classroom action buttons in the sanitized public edition.
- Branch: `codex/reorder-classroom-actions`
- Notes: Desktop rows and mobile cards now place `Edit` before `History`, with no school deployment details or runtime data.
- Verification: All 3 Node tests passed, and desktop plus mobile DOM order was checked for consistency.

### 2026-07-27 10:32:10 CST

- Event: Fixed list and dialog display issues introduced by the history action in the sanitized public edition.
- Branch: `codex/fix-history-display`
- Notes: Synced only the responsive display fix and bilingual documentation, with no school deployment details or runtime data.
- Verification: Horizontal desktop table overflow at 1280px dropped from 40px to 0; the 390px mobile page has no horizontal overflow and the title does not overlap the close button; all 3 Node tests passed.

### 2026-07-27 09:57:11 CST

- Event: Added classroom configuration history to the sanitized public edition and completed a full-project review.
- Branch: `codex/classroom-configuration-history`
- Notes: Synced application code, bilingual documentation, and synthetic-data rules only; added classroom timelines, legacy approval backfill, session ID rotation, photo transaction consistency, backup-config protection, and dependency fixes.
- Verification: All 3 Node tests passed; the production dependency audit found zero known vulnerabilities; desktop and 390px mobile acceptance passed; the public-repository privacy scan excludes private Git history and runtime data.

### 2026-07-18

- Event: Created the sanitized public edition of TeachingRoom Manager.
- Data: The repository contains only `初始化数据表格（虚拟）.xlsx`, whose 12 records are entirely fictional.
- History: The public repository starts from a clean snapshot and inherits no private-repository commits, branches, or pull-request references.
- Accounts: No fixed default password is used; the initial administrator password is supplied through an environment variable or generated randomly.
- Documentation: Chinese is the default language, English uses matching `.en.md` files, and every pair links to the other language.
- Verification: All three tests passed, the production dependency audit found zero known vulnerabilities, and the privacy scan found no real-inventory identifiers, private-network addresses, personal paths, private keys, or common token patterns.
