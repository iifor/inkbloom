# Sound credits

The recordings listed in the table below are public domain (CC0 1.0): free to use, change and ship, with no
attribution required. We credit the authors anyway, with thanks. Downloaded 2026-11-16.

| File(s)                                                | Author                                                          | Original                                                               | License |
| ------------------------------------------------------ | --------------------------------------------------------------- | ---------------------------------------------------------------------- | ------- |
| `kenney/footstep_*`, `kenney/impact*`                  | Kenney ([kenney.nl](https://kenney.nl/assets/impact-sounds))    | Impact Sounds                                                          | CC0 1.0 |
| `kenney/drawKnife*`, `knifeSlice*`, `metal*`, `cloth*` | Kenney ([kenney.nl](https://kenney.nl/assets/rpg-audio))        | RPG Audio                                                              | CC0 1.0 |
| `kenney/error_006`, `kenney/drop_002`                  | Kenney ([kenney.nl](https://kenney.nl/assets/interface-sounds)) | Interface Sounds                                                       | CC0 1.0 |
| `ambience/forest.ogg`                                  | TinyWorlds                                                      | [Forest Ambience](https://opengameart.org/content/forest-ambience)     | CC0 1.0 |
| `ambience/river.ogg`                                   | Thimras                                                         | [Park ambiences](https://opengameart.org/content/park-ambiences)       | CC0 1.0 |
| `ambience/rain.ogg`                                    | kindland                                                        | [Rain and thunders](https://opengameart.org/content/rain-and-thunders) | CC0 1.0 |

Changes: the Kenney files are unchanged and keep their names. The ambience files are cut from
the originals into 45–60 s seamless loops (the rain from a stretch without thunder), levelled
and re-encoded as Ogg Vorbis. Which sound plays where is
in `src/content/sounds.ts`; every one has a synthesised fallback, so the game still sounds
right without them.

The old Thimras birds loop is preserved in `art/audio/legacy-ambience/birds.ogg`, outside the shipped assets.

## AiSHA free recordings

Downloaded 2026-11-26 from SoundBits | Sound Effects' [SOME OF MANY (free)](https://aishasound.com/public-libraries/111). The library is offered under a free licence for personal and commercial projects, subject to the [AiSHA Audio License Agreement](https://aishasound.com/audio-license). These recordings are not CC0. They are included as edited assets of InkBloom, not offered as a standalone sound library. Do not redistribute the original downloads as a sample pack.

| Runtime file                      | Original SoundBits recording                            | Editing                                            |
| --------------------------------- | ------------------------------------------------------- | -------------------------------------------------- |
| `ambience/aisha-meadow-birds.ogg` | `AMBRurl_Countryside Birds Insects 04_SNDBTS_CAS14.wav` | 60 s loop, low rumble and high-frequency filtering |
| `ambience/aisha-wind.ogg`         | `AMBRurl_Contryside Heavy Wind_SNDBTS_CAS09.wav`        | 60 s loop, filtering                               |
| `ambience/aisha-glide-wind.ogg`   | `WINDGust_Wind Gust 27_SNDBTS_SDE-V5.wav`               | 6 s loop, filtering                                |
| `ambience/aisha-ink-rumble.ogg`   | `AMBDsgn_Dark SciFI Drone Layer 115_SNDBTS_DSD-CK.wav`  | 50 s loop, 35–200 Hz filtering                     |

All four excerpts use tail/head crossfades, conservative gain adjustment, and 48 kHz stereo Ogg Vorbis encoding. Processing settings and source hashes: `art/audio/aisha/processed.json`. Original files remain in a local, Git-ignored source directory.

## Generated NPC dialogue

voices/*.mp3: generated with Microsoft Azure Speech on 2026-11-25 using XiaoxiaoNeural, YunxiNeural, XiaoyiNeural and YunjianNeural (48 clips). These generated files are separate from the CC0 recordings above. Source lines and styles: scripts/generate-npc-voices.mjs. Credentials are supplied only through environment variables at generation time.

## User supplied generated music

The seven music/inkbloom-*.mp3 files were supplied by the project owner on 2026-11-26, following docs/audio-generation-prompts.md. They are byte-for-byte copies without re-encoding or loudness processing. These are separate from the CC0 recordings above; the generation service and license were not supplied.

| Source  | Runtime file                     | Role                           |
| ------- | -------------------------------- | ------------------------------ |
| M01.mp3 | music/inkbloom-colour-fields.mp3 | Occasional daytime exploration |
| M02.mp3 | music/inkbloom-blue-distance.mp3 | Occasional daytime exploration |
| M03.mp3 | music/inkbloom-grey-world.mp3    | Grey land                      |
| M04.mp3 | music/inkbloom-colour-world.mp3  | Colourful land                 |
| M05.mp3 | music/inkbloom-night.mp3         | Night                          |
| M06.mp3 | music/inkbloom-winter.mp3        | Winter daytime                 |
| M07.mp3 | music/inkbloom-ink-tide.mp3      | Ink tide                       |

The previous Komiku tracks are preserved outside the shipped assets in art/audio/legacy-komiku/, with their original source information alongside them.

## Loading music

`music/inkbloom-loading.mp3`: **Tiptoe on Parchment**, supplied by the project owner on 2026-11-28 for the loading screen. The 60.865-second MP3 is copied unchanged from `Tiptoe_on_Parchment.mp3`; playback volume and the exit fade are applied in the game. Source service and licence were not specified. This track is separate from the CC0 recordings above.
