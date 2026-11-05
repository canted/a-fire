# Storybook video fixture

`video-calibration.mp4` is a generated three-second, silent FFmpeg test pattern. It is a playback fixture, not user footage or product artwork.

Reproduce from the repository root:

```sh
ffmpeg -v error -y -f lavfi -i testsrc2=size=640x360:rate=24:duration=3 -an -c:v libx264 -pix_fmt yuv420p -preset veryfast -crf 26 -movflags +faststart -threads 1 public/storybook/media/video-calibration.mp4
```

The Video Attachments stories pass this file through the real video node and native player. Processing and failed examples use fixture metadata through the canonical SWR query.
