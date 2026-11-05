import { assignBrowserLocation } from "../../lib/browserNavigation";
import { FormEvent, useState } from "react";
import { Input } from "../../components/Input";
import { Button } from "../../components/Button";
import { Fire } from "../../animations/Fire";
import { useRequestOtpMutation } from "../../hooks/useOtp";
import { useStoredAuthSession } from "../../hooks/useStoredAuthSession";
import { appRoutes } from "../../../src/lib/appRoutes";
import styles from "./SitePage.module.css";

export function SitePage() {
  const navigate = (href: string) => assignBrowserLocation(href);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const requestMutation = useRequestOtpMutation();
  const { isAuthenticated } = useStoredAuthSession();

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setMessage(null);

    try {
      await requestMutation.mutateAsync({ email });
      // setMessage("If there's an account for this email, we’ve sent a code.");
      navigate(`/auth/verify?email=${encodeURIComponent(email)}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to send code right now.";
      setError(message);
    }
  };

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.fireFrame}>
          <Fire />
        </div>
        <small className={styles.tagline}>gather round</small>
        <h1 className={styles.brand}>a fire</h1>
      </section>
      <section className={styles.actions}>
        {isAuthenticated ? (
          <div className={styles.authenticatedActions}>
            <Button type="button" color="bright" size="sm" onClick={() => navigate(appRoutes.home())}>
              Sign in
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className={styles.form}>
            <h2 className={styles.title}>Sign in</h2>
            <Input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              placeholder="you@example.com"
              error={error || undefined}
              className={styles.input}
            />
            <div className={styles.submitRow}>
              <Button type="submit" disabled={requestMutation.isPending} color="bright" size="sm">
                {requestMutation.isPending ? "Sending…" : "Continue"}
              </Button>
            </div>
            {message && <p className={styles.message}>{message}</p>}
          </form>
        )}
      </section>
    </div>
  );
}
