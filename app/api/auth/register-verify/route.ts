import { NextRequest, NextResponse } from 'next/server';
import { verifyRegistrationResponse, type RegistrationResponseJSON } from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { z } from 'zod';
import { ApiError, apiHandler, readJson } from '@/lib/api';
import { consumeChallenge, createSession, registerCredential, webauthnSettings } from '@/lib/auth';
import { usernameSchema } from '@/lib/validation';

export const runtime = 'nodejs';
const schema = z.object({
  username: usernameSchema,
  response: z.object({ id: z.string().min(1).max(2048).regex(/^[A-Za-z0-9_-]+$/) }).passthrough(),
}).strict();

export async function POST(request: NextRequest) {
  return apiHandler(request, async (session) => {
    const { username, response } = schema.parse(await readJson(request));
    const challenge = await consumeChallenge('register', username);
    if (!challenge) throw new ApiError(400, 'Registration challenge expired or invalid');
    if (challenge.userId !== session?.userId) throw new ApiError(401, 'Registration identity changed. Please retry.');
    const { rpID, origin } = webauthnSettings();
    let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
    try {
      verification = await verifyRegistrationResponse({
        response: response as unknown as RegistrationResponseJSON,
        expectedChallenge: challenge.challenge, expectedOrigin: origin, expectedRPID: rpID,
        requireUserVerification: true,
      });
    } catch { throw new ApiError(401, 'Passkey verification failed'); }
    if (!verification.verified || !verification.registrationInfo) throw new ApiError(401, 'Passkey verification failed');
    const credential = verification.registrationInfo.credential;
    const credentialId = isoBase64URL.fromBuffer(isoBase64URL.toBuffer(credential.id));
    let user;
    try {
      user = registerCredential(username, { ...credential, id: credentialId, counter: credential.counter ?? 0 }, challenge.userId);
    } catch (error) {
      if (error instanceof Error && 'code' in error && String(error.code).startsWith('SQLITE_CONSTRAINT')) {
        throw new ApiError(409, 'Username or passkey already registered');
      }
      throw error;
    }
    await createSession(user);
    return NextResponse.json({ success: true });
  }, { public: true });
}
