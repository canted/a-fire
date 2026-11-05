// Composer state stories do not exercise recording or playback.
// Fail explicitly if a story starts using these platform capabilities.
const unsupported = () => { throw new Error("Audio playback requires the real Expo application in this story."); };
export const useAudioPlayer = unsupported;
export const useAudioPlayerStatus = unsupported;
