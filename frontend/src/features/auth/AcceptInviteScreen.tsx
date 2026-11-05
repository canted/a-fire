import { usePageSurface } from "../../hooks/usePageSurface";
import { useRef, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Button } from "../../components/Button";
import { Fire } from "../../components/Fire";
import { useAuthentication, useSession } from "../../hooks/useSession";
import { inviteRecoveryMessage } from "../../lib/api/authInvite";
import { safeRoomReturn } from "../../lib/roomLinks";
import { tokens } from "../../styles/tokens";
import { layout } from "../../styles/layout";

export function AcceptInviteScreen() {
  usePageSurface(tokens.ink, tokens.bright);
  const { token } = useLocalSearchParams<{ token: string }>();
  const { ready, error: storageError } = useSession();
  const { invite } = useAuthentication();
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [recovery, setRecovery] = useState(false);
  const flight = useRef(false);
  const accept = async () => {
    if (flight.current || !ready || storageError) return;
    if (!token) {
      setError("Invalid invite link.");
      return;
    }
    flight.current = true;
    setError(undefined);
    setRecovery(false);
    try {
      const result = await invite.trigger(token);
      router.replace(safeRoomReturn(result.redirect));
    } catch (reason) {
      const message =
        reason instanceof Error
          ? reason.message
          : "Unable to accept this invite right now.";
      const recover = inviteRecoveryMessage(message);
      setError(recover || message);
      setRecovery(Boolean(recover));
    } finally {
      flight.current = false;
    }
  };
  return (
    <SafeAreaView style={[layout.page, styles.page]}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.fire}>
          <Fire />
        </View>
        <Text style={styles.tagline}>gather round</Text>
        <Text accessibilityRole="header" style={styles.brand}>
          a fire
        </Text>
        <Button
          shape="pill"
          emphasis="link"
          color={tokens.bright}
          disabled={!ready || invite.isMutating || Boolean(storageError)}
          onPress={() => {
            void accept();
          }}
        >
          {invite.isMutating ? "Accepting…" : "Accept invitation"}
        </Button>
        {(error || storageError) && (
          <Text accessibilityRole="alert" style={styles.notice}>
            {error || storageError}
          </Text>
        )}
        {recovery && (
          <Button
            emphasis="link"
            color={tokens.bright}
            onPress={() => router.push("/auth")}
          >
            Sign in
          </Button>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  page: { backgroundColor: tokens.ink },
  content: {
    alignItems: "center",
    padding: 24,
    gap: 16,
    width: "100%",
    maxWidth: 512,
    alignSelf: "center",
  },
  fire: { width: 300, maxWidth: "100%", aspectRatio: 836 / 1520 },
  tagline: { color: tokens.bright, fontFamily: "Lato", fontSize: 14 },
  brand: { color: tokens.bright, fontFamily: "Grenze", fontSize: 48 },
  notice: {
    color: tokens.bright,
    fontFamily: "Lato",
    fontSize: 14,
    textAlign: "center",
  },
});
