# Synthetic Storybook audio fixtures

The MP3s in this public snapshot are generated 25-second sine tones, not excerpts of recordings. Historical filenames remain for fixture compatibility. `manifest.json` contains their actual titles, durations, and SHA-256 checksums.

Regenerate with Node.js, FFmpeg, and FFprobe installed:

```sh
node frontend/scripts/prepare-storybook-audio.mjs
```

The retained `calibration.wav` is a generated 12-second frequency calibration signal. These fixtures exercise playback and waveform rendering; they are not evidence of how complex recorded music sounds or looks.
