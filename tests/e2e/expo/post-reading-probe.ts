import { latestOtp } from '../fixtures/otp';
import { prisma } from '../fixtures/database';
import { seedExpoReading } from '../fixtures/expoReading';

// Uses the real OTP and send endpoints. The fixture import rejects normal DBs.
async function post(path: string, body: unknown, token?: string) {
  const response = await fetch(`http://127.0.0.1:4000/api${path}`, { method: 'POST', headers: {
    'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}),
  }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
try {
  const fixture = await seedExpoReading();
  const email = 'expo-reader-peer@example.test';
  await post('/v1/auth/request_otp', { email });
  const tokens = await post('/v1/auth/verify_otp', { email, token: await latestOtp(email) });
  const body = `Live during stalled history ${Date.now()}`;
  if (!tokens?.accessToken) throw new Error('Probe sign-in failed');
  const message = await post(`/v2/rooms/${fixture.roomId}/chat/messages`, { body, client_nonce: `stalled-${Date.now()}` }, tokens.accessToken);
  console.log(JSON.stringify({ roomId: fixture.roomId, id: message.id, body }));
} finally { await prisma.$disconnect(); }
