# Proton All

Interactive Apps For Proton Drive

A Local Web Interface And A Terminal Browser For Proton Drive, Built On
[rclone](https://rclone.org) (Native `protondrive` Backend, 1.64 Or Newer).
Browse The Drive, Download, Upload, Compare A Local Folder With A Proton Folder
And Mirror One Way. Nothing Moves Without A `--dry-run` Preview First.

## Quick Start (Docker)

```bash
cp .env.example .env     # Set PDRIVE_DATA_DIR To A Folder On This Machine
./up.sh                  # Builds, Starts And Opens The Browser
```

Log In In The Browser (Username, Password, Mfa Code). The Session Is Kept In A
Docker Volume; *Out* In The Sidebar Removes It. After The Login Choose The Local
Folder Inside `PDRIVE_DATA_DIR` To Work With.

Without `up.sh`: `docker compose up -d --build`, Then Open The Link
`http://127.0.0.1:8765/?k=…` From `docker compose logs pdrive`.

## Features

- **Files**: Browse, Download, Upload, New Folder, Size, Delete (Type `DELETE`).
- **Compare**: Local Against Proton, File By File (Only Local, Only Remote,
  Local Newer, Remote Newer, Different, Same). Progress, Cancel And A Five Minute
  Cache, Because Proton Is Read Folder By Folder.
- **Mirror**: Make Proton Like The Local Folder, Or The Other Way Round. Deletions
  Are Off By Default And Need `DELETE`.
- **Conflict Policies**: Overwrite If Different, Skip Existing, Overwrite If
  Newer, Keep Both (`name.old-<time>.ext`).
- **Terminal**: `docker compose exec pdrive pdrive` Or `pdrive` After `install.sh`.

## Safety

- The Port Is Published On `127.0.0.1` Only. Do Not Expose It.
- Access Needs The One-Time Link (`?k=…`, Set `PDRIVE_KEY` For A Fixed One); Foreign
  Host And Origin Headers Are Refused.
- Only `PDRIVE_DATA_DIR` Can Be Read Or Written Locally.
- One rclone Runs At A Time, Because Proton Rotates Session Tokens.
- The Session And The Obscured Password Live In The Volume, Not In `.env`.
  Logging Out Does Not Revoke The Session On Proton's Side.
- A Wrong Login Can Trigger HTTP 429 From Proton: Wait A Few Minutes.

## Without Docker

```bash
./install.sh             # rclone (Checksum Verified), pdrive, pdrive-web
pdrive-web               # Web Interface
pdrive                   # Terminal
```

`pdrive-selftest` Checks How Your Drive Behaves (Session, Modification Times,
Keep Both, Listing Speed) With A Throwaway Folder.

## Configuration

| Variable | Purpose |
|---|---|
| `PDRIVE_DATA_DIR` | Local Top Folder (Docker, Required) |
| `PUID`, `PGID` | Owner Of Downloaded Files |
| `PDRIVE_PORT` | Host Port (Default 8765) |
| `PDRIVE_KEY` | Fixed Access Key |
| `PDRIVE_REMOTE`, `PDRIVE_RCLONE`, `PDRIVE_LOCAL` | Remote Name, rclone Binary, Default Local Folder (Without Docker) |

## Tests

```bash
tests/run.sh             # Needs rclone On PATH Or REAL_RCLONE=/path/to/rclone
```

The Proton Login Is Faked And Transfers Use A Local Folder: Your Drive Is Never
Touched.

## License

MIT
