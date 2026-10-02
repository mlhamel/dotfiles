# apt

Debian/Ubuntu package management — the Linux counterpart to [`../homebrew`](../homebrew).

## Files

| File          | Purpose                                                                                   |
| ------------- | ----------------------------------------------------------------------------------------- |
| `Aptfile`     | Curated list of manually-installed packages (one per line)                                |
| `generate.sh` | Dump this machine's packages into `Aptfile`, filtering Debian's base footprint            |
| `exclude.txt` | Packages to keep out of the Aptfile (installed locally, but not managed)                  |
| `install.sh`  | Install everything in the Aptfile                                                         |
| `sources.sh`  | Configure the third-party vendor repos (docker, chrome, brave, code, spotify, gh, gcloud) |

## Usage

Fresh Debian/Ubuntu machine:

```bash
sudo ./sources.sh    # vendor repos first (their packages won't resolve otherwise)
./install.sh
```

Refresh the Aptfile after installing/removing packages:

```bash
./generate.sh
./generate.sh --check   # CI-style: exit 1 if out of date (run locally, not in CI)
```

## How the base-package filter works

Unlike `brew bundle dump`, which lists only what you added yourself,
`apt-mark showmanual` on Debian includes the base system seeded at install
time (~323 packages on a desktop install: `bash`, `coreutils`, `grep`, ...).
`generate.sh` filters out, in order:

1. dpkg priority `required`/`important`/`standard` AND not essential,
2. dpkg essential packages (`bash`, `coreutils`, `dpkg`, ...),
3. runtime `lib*` dependencies (kept: `lib*-dev` and names the pattern misses),
4. anything listed in `exclude.txt` (firmware, bootloader, `task-*` metas,
   GPU toolchain — deliberately machine-local).

The result (~114 packages on my machine, down from 242 in the first dump)
is what a human deliberately installed. The list is _not_ perfect — review
the diff when regenerating.

## Notes

- **No lockfile analog:** apt resolves versions at install time; there is no
  `Brewfile.lock.json` equivalent here.
- **Third-party sources:** `sources.sh` configures the vendor repos the
  Aptfile needs (`docker-ce`, `google-chrome-stable`, `brave-browser`,
  `code`, `spotify-client`, `gh`, `google-cloud-cli`). Idempotent — existing
  sources are skipped; `--dry-run` shows what it would do. Keyrings are
  fetched at runtime, never stored in this repo.
- `install.sh` uses `--no-install-recommends` to keep machines lean; drop it
  if a desktop package misses an expected component.
