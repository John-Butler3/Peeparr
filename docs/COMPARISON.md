# Why Peeparr?

The questions people ask about self-hosting an adult library, and where
Peeparr fits.

## "Why not just use Plex or Jellyfin?"

You can, and you can keep using them. Peeparr doesn't move, rename or own
your files: they stay where Whisparr and Stash put them, so Plex or Jellyfin
can index the same folders if you want everything in one player.

What Peeparr adds for this kind of library:

- **Scenes that are actually recognised.** General media servers match
  movies and TV shows. Adult scenes have no consistent file naming, and the
  big movie databases leave them out, so Plex and Jellyfin need third-party
  agents and renaming tools to get close. Peeparr uses Stash's own matching
  and StashDB or ThePornDB, which are built for scenes, performers and sites.
- **Kept separate.** Plex can't hide a library from its own account, and
  extra managed users need Plex Pass. Peeparr is its own app with its own
  login and no cloud account, and it has a discreet logo you can switch on
  for the home screen.

## "Why not just use Stash?"

Stash is the library: keep using it to scan, tag and organise. Peeparr sits
on top of it and doesn't change how Stash works.

- **Stash doesn't download.** Peeparr finds new scenes in the catalog,
  requests them through Whisparr and follows each one into Stash.
- **Made for watching, especially on a phone.** Stash is built for curating,
  and its issue tracker has years of phone complaints: hover-only actions,
  previews that won't start, layouts cut off by the notch. Peeparr has a
  floating phone navigation bar, previews that play as you scroll, swipe
  down to the miniplayer, and lock-screen controls. Add it to your home
  screen and it opens like an app.

## "Why not just use Whisparr?"

Whisparr downloads; it doesn't play anything, and browsing the catalog in it
is slow work. Peeparr gives you the catalog as pages to browse, one-click
requests, and each scene's status (requested, downloading, importing,
failed, ready) right beside its title, then plays it once it's in your
library.

## "Isn't there an Overseerr for this?"

Overseerr and Jellyseerr support Sonarr and Radarr, not Whisparr. The adult
tools that exist each cover part of the job:

| | Browse catalog | Request | Follow downloads | Your library | Whisparr | Catalog |
| --- | --- | --- | --- | --- | --- | --- |
| Stasharr userscript | on StashDB's site | yes | status on StashDB | – | Eros (v3) | StashDB |
| Stasharr Portal | yes | yes | yes | browse | Eros (v3) | StashDB, FansDB |
| tpdbarr | yes | yes | yes | browse and watch | v2, alongside v3 | ThePornDB |
| **Peeparr** | yes | yes | yes | browse and watch | **v2 or Eros** | **StashDB or ThePornDB** |

Peeparr is built on Stasharr Portal (see [Credits](../README.md#credits)),
and detects which Whisparr you run, so there's no second instance to keep.

## "Do I have to give anything up?"

No. Peeparr is an add-on:

- **Stash** stays your library and does the organising.
- **Whisparr** stays your downloader.
- **Plex or Jellyfin** can carry on alongside, on the same files.

Turn Peeparr off and everything else carries on as before.

## What Peeparr isn't

- Not a general media server: it's for the adult library in Stash, not your
  films and TV.
- Not multi-user: there's one local admin account.
- Not standalone: it needs Stash and Whisparr running.
