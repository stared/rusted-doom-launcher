# IWAD thumbnails

Bundled cover images shown on Play-view cards for installed IWADs. Each
file is the result of downloading the source below and running it through
`sips -s format jpeg -s formatOptions 85 -Z 800`. The two Freedoom shots
were additionally pre-cropped to 16:9 with `magick … -crop 1600x900+0+0`
so the HUD strip at the bottom does not survive the card's `object-cover`
framing.

| File            | Source                                                    |
| --------------- | --------------------------------------------------------- |
| `doom.jpg`      | https://doomwiki.org/w/images/4/4b/Doom-1-.gif            |
| `doom2.jpg`     | https://doomwiki.org/w/images/5/51/Doom2_title.png        |
| `plutonia.jpg`  | https://doomwiki.org/w/images/0/0c/Plutonia_title.gif     |
| `tnt.jpg`       | https://doomwiki.org/w/images/e/ed/TNT_title.gif          |
| `heretic.jpg`   | https://doomwiki.org/w/images/b/b3/Heretictitle.png       |
| `hexen.jpg`     | https://doomwiki.org/w/images/5/5f/Hexen.png              |
| `freedoom1.jpg` | https://freedoom.github.io/img/screenshots/p1_1.png       |
| `freedoom2.jpg` | https://freedoom.github.io/img/screenshots/p2_1.png       |
