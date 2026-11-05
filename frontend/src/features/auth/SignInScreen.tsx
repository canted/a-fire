import { usePageSurface } from "../../hooks/usePageSurface";
import { safeRoomReturn } from "../../lib/roomLinks";
import { useState } from "react";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "../../components/Button";
import { Input } from "../../components/Input";
import { useAuthentication, useSession } from "../../hooks/useSession";
import { Fire } from "../../components/Fire";
import { tokens } from "../../styles/tokens";
import { StatusBar } from "expo-status-bar";
import { layout } from "../../styles/layout";

export function SignInScreen({
  initialVerify = false,
}: { initialVerify?: boolean } = {}) {
  usePageSurface(tokens.ink, tokens.bright);
  const { ready, signedIn, error: storageError } = useSession();
  const { next, email: searchEmail } = useLocalSearchParams<{
    next?: string;
    email?: string;
  }>();
  const router = useRouter();
  const { request, verify } = useAuthentication();
  const [email, setEmail] = useState(initialVerify ? (searchEmail ?? "") : "");
  const [token, setToken] = useState("");
  const [sent] = useState(
    initialVerify &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((searchEmail ?? "").trim()),
  );
  const [error, setError] = useState<string | null>(null);
  const busy = request.isMutating || verify.isMutating;
  if (ready && signedIn)
    return <Redirect href={safeRoomReturn(next) as "/app"} />;
  const submit = async () => {
    if (
      busy ||
      !ready ||
      storageError ||
      (sent
        ? token.length !== 6
        : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
    )
      return;
    setError(null);
    try {
      if (sent) await verify.trigger({ email: email.trim(), token });
      else {
        await request.trigger({ email: email.trim() });
        router.replace({
          pathname: "/auth/verify",
          params: { email: email.trim(), next: safeRoomReturn(next) },
        });
      }
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not sign in. Please try again.",
      );
    }
  };
  return (
    <SafeAreaView style={[layout.page, styles.page]}>
      <StatusBar style="light" />
      <KeyboardAvoidingView
        style={layout.grow}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={styles.content}
        >
          <View style={styles.fire}>
            <Fire />
          </View>
          {sent && (
            <Text style={styles.notice}>
              A code was sent if the email was found
            </Text>
          )}
          <View style={styles.form}>
            <Text accessibilityRole="header" style={styles.title}>
              {sent ? "Enter code" : "Sign in"}
            </Text>
            <View style={styles.fields}>
              {sent ? (
                <Input
                  key="code"
                  style={styles.code}
                  accessibilityLabel="Verification code"
                  value={token}
                  onChangeText={(value) =>
                    setToken(value.replace(/\D/g, "").slice(0, 6))
                  }
                  keyboardType="number-pad"
                  autoComplete="one-time-code"
                  maxLength={6}
                  onSubmitEditing={() => void submit()}
                />
              ) : (
                <Input
                  style={styles.input}
                  accessibilityLabel="Email address"
                  placeholder="you@example.com"
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  onSubmitEditing={() => void submit()}
                />
              )}
              {(error || storageError) && (
                <Text accessibilityRole="alert" style={styles.notice}>
                  {error || storageError}
                </Text>
              )}
              <Button
                style={styles.action}
                color={tokens.warning}
                disabled={
                  !ready ||
                  busy ||
                  Boolean(storageError) ||
                  (sent
                    ? token.length !== 6
                    : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
                }
                onPress={() => void submit()}
              >
                {busy ? "Please wait…" : sent ? "Sign in" : "Continue"}
              </Button>
              {sent && (
                <Button
                  emphasis="link"
                  disabled={busy}
                  onPress={() => {
                    router.replace({
                      pathname: "/auth",
                      params: { next: safeRoomReturn(next) },
                    });
                  }}
                >
                  <Text style={styles.startOver}>Start over</Text>
                </Button>
              )}
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { backgroundColor: tokens.ink },
  content: {
    width: "100%",
    maxWidth: 512,
    alignSelf: "center",
    paddingHorizontal: 16,
    paddingBottom: 24,
    alignItems: "center",
    gap: 24,
  },
  fire: { width: 300, maxWidth: "100%", aspectRatio: 836 / 1520 },
  form: { width: 236, gap: 16 },
  fields: { gap: 16 },
  title: {
    color: tokens.bright,
    fontFamily: "Grenze",
    fontSize: 36,
    lineHeight: 45,
    textAlign: "center",
  },
  startOver: {
    fontFamily: "Lato",
    color: tokens.cool,
    fontSize: 16,
    textDecorationLine: "underline",
  },
  notice: {
    color: tokens.bright,
    fontFamily: "Lato",
    fontSize: 14,
    textAlign: "center",
  },
  input: {
    backgroundColor: tokens.surface,
    borderColor: tokens.surface,
    borderRadius: 0,
    fontSize: 14,
  },
  code: {
    backgroundColor: tokens.surface,
    letterSpacing: 14,
    fontSize: 24,
    textAlign: "center",
  },
  action: {
    alignSelf: "flex-end",
    borderTopRightRadius: 12,
    borderBottomLeftRadius: 12,
    borderTopLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
});

export function VerifySignInScreen() {
  const { email } = useLocalSearchParams<{ email?: string }>();
  return <SignInScreen key={email ?? ""} initialVerify />;
}
