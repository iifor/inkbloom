# Sound credits

The recordings listed in the table below are public domain (CC0 1.0): free to use, change and ship, with no
attribution required. We credit the authors anyway, with thanks. Downloaded 2026-11-16.

| File(s)                                                | Author                                                          | Original                                                                 | License |
| ------------------------------------------------------ | --------------------------------------------------------------- | ------------------------------------------------------------------------ | ------- |
| `kenney/footstep_*`, `kenney/impact*`                  | Kenney ([kenney.nl](https://kenney.nl/assets/impact-sounds))    | Impact Sounds                                                            | CC0 1.0 |
| `kenney/drawKnife*`, `knifeSlice*`, `metal*`, `cloth*` | Kenney ([kenney.nl](https://kenney.nl/assets/rpg-audio))        | RPG Audio                                                                | CC0 1.0 |
| `kenney/error_006`, `kenney/drop_002`                  | Kenney ([kenney.nl](https://kenney.nl/assets/interface-sounds)) | Interface Sounds                                                         | CC0 1.0 |
| `ambience/forest.ogg`                                  | TinyWorlds                                                      | [Forest Ambience](https://opengameart.org/content/forest-ambience)       | CC0 1.0 |
| `ambience/birds.ogg`, `ambience/river.ogg`             | Thimras                                                         | [Park ambiences](https://opengameart.org/content/park-ambiences)         | CC0 1.0 |
| `ambience/rain.ogg`                                    | kindland                                                        | [Rain and thunders](https://opengameart.org/content/rain-and-thunders)   | CC0 1.0 |
| `music/komiku-champ-de-tournesol.ogg`                  | Komiku                                                          | [Champ de tournesol](https://opengameart.org/content/champ-de-tournesol) | CC0 1.0 |
| `music/komiku-bleu.ogg`                                | Komiku                                                          | [Bleu](https://opengameart.org/content/bleu)                             | CC0 1.0 |

Changes: the Kenney files are unchanged and keep their names. The ambience files are cut from
the originals into 45–60 s seamless loops (the rain from a stretch without thunder), levelled
and re-encoded as Ogg Vorbis; the music is re-encoded as Ogg Vorbis. Which sound plays where is
in `src/content/sounds.ts`; every one has a synthesised fallback, so the game still sounds
right without them.

Only add recordings whose license is CC0 (public domain).


## Generated NPC dialogue

voices/*.mp3: generated with Microsoft Azure Speech on 2026-11-25 using XiaoxiaoNeural, YunxiNeural, XiaoyiNeural and YunjianNeural (48 clips). These generated files are separate from the CC0 recordings above. Source lines and styles: scripts/generate-npc-voices.mjs. Credentials are supplied only through environment variables at generation time.
