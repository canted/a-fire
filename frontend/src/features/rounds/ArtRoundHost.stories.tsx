import type { ArtBeforeChorusRoundState } from "../../lib/api/rounds";
import { ArtRoundHost } from "./ArtRoundHost";
import { PageScrollView } from "../../components/PageScrollView";
import { View } from "react-native";
export default { title: "Expo/Rounds/Host" };
const base: ArtBeforeChorusRoundState = {
  key: "art_before_chorus",
  phase: "collecting_covers",
  isHost: true,
  config: { responseFormat: "any", sketchSize: "tiny" },
  coverProgress: {
    submitted: 0,
    minimum: 3,
    remaining: 3,
    waitingPastSchedule: false,
  },
  participants: [],
  viewer: {},
  results: [],
};
const people: ArtBeforeChorusRoundState["participants"] = [
  {
    id: "1",
    userId: "1",
    name: "A participant with a deliberately long display name",
    hasCover: false,
    responseStatus: "choosing",
  },
  {
    id: "2",
    userId: "2",
    name: "Another participant",
    hasCover: false,
    responseStatus: "making",
  },
];
function Fixture({
  state,
  busy = false,
}: {
  state: ArtBeforeChorusRoundState;
  busy?: boolean;
}) {
  return (
    <View style={{ height: 620 }}>
      <PageScrollView>
        <ArtRoundHost
          state={state}
          busy={busy}
          reminded={new Set()}
          remind={() => {}}
          remove={() => {}}
        />
      </PageScrollView>
    </View>
  );
}
export const Empty = () => <Fixture state={base} />;
export const WaitingForCovers = () => (
  <Fixture state={{ ...base, participants: people }} />
);
export const ResponsesInProgress = () => (
  <Fixture
    state={{ ...base, phase: "collecting_responses", participants: people }}
  />
);
export const Busy = () => (
  <Fixture
    busy
    state={{ ...base, phase: "collecting_responses", participants: people }}
  />
);
