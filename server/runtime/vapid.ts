export type VapidEnv = Record<string, string | undefined> & Partial<
  Record<
    | "VITE_VAPID_PUBLIC_KEY"
    | "VITE_VAPID_PRIVATE_KEY"
    | "VITE_VAPID_SUBJECT"
    | "VAPID_PUBLIC_KEY"
    | "VAPID_PRIVATE_KEY"
    | "VAPID_SUBJECT"
    | "BREVO_SENDER",
    string | undefined
  >
>;

export type VapidConfig = {
  publicKey?: string;
  privateKey?: string;
  subject?: string;
};

export type CompleteVapidConfig = {
  publicKey: string;
  privateKey: string;
  subject: string;
  source: "vite" | "legacy";
};

export function readVapidPublicKey(env: VapidEnv = process.env): string | undefined {
  return cleanVapidValue(env.VITE_VAPID_PUBLIC_KEY) ?? cleanVapidValue(env.VAPID_PUBLIC_KEY);
}

export function readVapidPrivateKey(env: VapidEnv = process.env): string | undefined {
  return cleanVapidValue(env.VITE_VAPID_PRIVATE_KEY) ?? cleanVapidValue(env.VAPID_PRIVATE_KEY);
}

export function readVapidSubject(env: VapidEnv = process.env): string | undefined {
  const configuredSubject = cleanVapidValue(env.VITE_VAPID_SUBJECT) ?? cleanVapidValue(env.VAPID_SUBJECT);
  if (configuredSubject) return configuredSubject;

  const sender = cleanVapidValue(env.BREVO_SENDER);
  return sender ? `mailto:${sender}` : undefined;
}

export function readVapidConfig(env: VapidEnv = process.env): VapidConfig {
  return {
    publicKey: readVapidPublicKey(env),
    privateKey: readVapidPrivateKey(env),
    subject: readVapidSubject(env),
  };
}

export function readCompleteVapidConfigs(env: VapidEnv = process.env): CompleteVapidConfig[] {
  const senderSubject = senderToSubject(env.BREVO_SENDER);
  const configs = [
    completeConfig({
      publicKey: cleanVapidValue(env.VITE_VAPID_PUBLIC_KEY),
      privateKey: cleanVapidValue(env.VITE_VAPID_PRIVATE_KEY),
      subject: cleanVapidValue(env.VITE_VAPID_SUBJECT) ?? senderSubject,
      source: "vite",
    }),
    completeConfig({
      publicKey: cleanVapidValue(env.VAPID_PUBLIC_KEY),
      privateKey: cleanVapidValue(env.VAPID_PRIVATE_KEY),
      subject: cleanVapidValue(env.VAPID_SUBJECT) ?? senderSubject,
      source: "legacy",
    }),
  ];

  return uniqueCompleteConfigs(configs.filter((config): config is CompleteVapidConfig => Boolean(config)));
}

function cleanVapidValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (trimmed.includes("%")) return undefined;
  if (trimmed.toLowerCase().includes("vapid_public_key")) return undefined;
  return trimmed;
}

function senderToSubject(sender: string | undefined): string | undefined {
  const cleanSender = cleanVapidValue(sender);
  return cleanSender ? `mailto:${cleanSender}` : undefined;
}

function completeConfig(config: VapidConfig & { source: CompleteVapidConfig["source"] }): CompleteVapidConfig | null {
  if (!config.publicKey || !config.privateKey || !config.subject) return null;
  return {
    publicKey: config.publicKey,
    privateKey: config.privateKey,
    subject: config.subject,
    source: config.source,
  };
}

function uniqueCompleteConfigs(configs: CompleteVapidConfig[]): CompleteVapidConfig[] {
  const seen = new Set<string>();
  return configs.filter((config) => {
    const key = `${config.publicKey}:${config.privateKey}:${config.subject}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
