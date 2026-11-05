import { useEffect, useState } from "react";
import { Text } from "react-native";
import { Button } from "../../components/Button";
import { RecordingDrawer } from "./RecordingDrawer";
import type { useChatRecording } from "../../hooks/useChatRecording";

export default { title: "Expo/Content/Recording drawer", component: RecordingDrawer };
function Fixture({ initialRecording = false, denied = false }) {
  const [open, setOpen] = useState(true);
  const [recording, setRecording] = useState(initialRecording);
  const [seconds, setSeconds] = useState(0);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [review, setReview] = useState<ReturnType<typeof useChatRecording>["review"]>();
  const [added, setAdded] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!recording) return;
    let sample = 0;
    const timer = setInterval(() => {
      sample++;
      setPeaks(previous => [...previous.slice(-159), Math.abs(Math.sin(sample / 5)) * 0.7]);
      setSeconds(Math.floor(sample / 20));
    }, 50);
    return () => clearInterval(timer);
  }, [recording]);
  const controller: ReturnType<typeof useChatRecording> = {
    recording, preparing: false, seconds, peaks, review, error,
    start: async () => { if (denied) setError("Microphone access was declined. Try again, or close the recorder to attach an audio file."); else setRecording(true); },
    finish: async () => { setRecording(false); setReview({ id: "fixture-take", uri: "blob:fixture", name: "Recording.webm", type: "audio/webm", size: 32 }); },
    cancel: async () => { setRecording(false); setReview(undefined); },
    useRecording: async () => { setReview(undefined); setAdded(true); return true; },
  };
  return <>
    {added && <Text>Recording attached</Text>}
    <Button onPress={() => { setSeconds(0); setPeaks([]); setOpen(true); }}>Record audio</Button>
    <RecordingDrawer recording={controller} open={open} onClose={() => setOpen(false)} />
  </>;
}
export const Ready = () => <Fixture />;
export const Recording = () => <Fixture initialRecording />;
export const PermissionDenied = () => <Fixture denied />;
