# AiSHA source and processing record

Imported 2026-11-26. The project owner requested AiSHA recordings and preferred free material. Total purchase cost: **$0**. No subscription or paid order was placed.

All four shipped clips come from SoundBits | Sound Effects' [SOME OF MANY (free)](https://aishasound.com/public-libraries/111). Source names, outputs and credits are in [CREDITS.md](../../../public/sounds/CREDITS.md); processing parameters, hashes and output sizes are in [processed.json](processed.json). The free library permits commercial project use under the [AiSHA Audio License Agreement](https://aishasound.com/audio-license); it is not a CC0 library.

Original downloads are stored in the local, Git-ignored `source/` directory. They are excluded from the public game assets and should not be distributed as a sample library. The archive `countryside-samples.zip` comes from In Motion Audio's [Countryside Samples](https://aishasound.com/public-libraries/126-countryside-samples); no recording from that archive is currently shipped.

To reproduce the four processed clips, supply the same source downloads and run:

```powershell
node scripts/prepare-aisha-audio.mjs 'C:/path/to/ffmpeg.exe'
```

The script selects a bounded excerpt, filters it, rotates and crossfades its tail/head, measures its level, adjusts gain toward −24 dBFS mean without exceeding a −6 dBFS pre-encoding peak, and encodes stereo 48 kHz Vorbis. This is a measured gain adjustment, not LUFS loudness normalization. Each output is fully decoded to check for file errors. Final listening and scene balance remain subjective checks.

The meadow source includes birds, insects, crows, a rooster, wind and tree rustle; it is a mixed rural ambience, not an isolated bird call. The low-frequency rumble listed in its metadata is reduced by filtering. The separate forest/stream sample lists a distant flight pass-by, and Countryside Samples lists distant traffic, so those downloads have not replaced the current forest or river loops.
