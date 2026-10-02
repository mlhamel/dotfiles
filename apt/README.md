# apt

Debian/Ubuntu package management — the Linux counterpart to [`../homebrew`](../homebrew).

## Files

| File          | Purpose                                                                        |
| ------------- | ------------------------------------------------------------------------------ |
| `Aptfile`     | Curated list of manually-installed packages (one per line)                     |
| `generate.sh` | Dump this machine's packages into `Aptfile`, filtering Debian's base footprint |
| `exclude.txt` | Packages to keep out of the Aptfile (installed locally, but not managed)       |
| `install.sh`  | Install everything in the Aptfile                                              |

## Usage

Fresh Debian/Ubuntu machine:

```bash
./install.sh
```

Refresh the Aptfile after installing/removing packages:

```bash
./generate.sh
./generate.sh --check   # CI-style: exit 1 if out of date
```

## How the base-package filter works

Unlike `brew bundle dump`, which lists only what you added yourself,
`apt-mark showmanual` on Debian includes the base system seeded at install
time (~323 packages on a desktop install: `bash`, `coreutils`, `grep`, ...).
`generate.sh` filters out any package that is:

1. dpkg priority `required`/`important`/`standard` AND not essential, or
2. listed in `exclude.txt`

leaving only what a human deliberately installed (~242 on my machine).
The list is _not_ perfect — review the diff when regenerating.

## Notes

- **No lockfile analog:** apt resolves versions at install time; there is no
  `Brewfile.lock.json` equivalent here.
- **Third-party sources are out of scope:** packages from vendor repos
  (`docker-ce`, `google-chrome-stable`, `brave-browser`, `code`, ...) only
  resolve if their apt sources/keyrings are already configured on the
  machine. `install.sh` manages the package list, not the sources.
- `install.sh` uses `--no-install-recommends` to keep machines lean; drop it
  if a desktop package misses an expected component.
