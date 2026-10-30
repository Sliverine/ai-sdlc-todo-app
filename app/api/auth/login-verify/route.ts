import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthenticationResponse, type AuthenticationResponseJSON } from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { z } from 'zod';
import { ApiError, apiHandler, readJson } from '@/lib/api';
import { consumeChallenge, createSession, webauthnSettings } from '@/lib/auth';
import { authenticatorDB, getDatabase, userDB } from '@/lib/db';
import { usernameSchema } from '@/lib/validation';

export const runtime = 'nodejs';
const schema = z.object({
  username: usernameSchema,
  response: z.object({ id: z.string().min(1).max(2048).regex(/^[A-Za-z0-9_-]+$/) }).passthrough(),
}).strict();

export async function POST(request: NextRequest) {
  return apiHandler(request, async () => {
    const { username, response } = schema.parse(await readJson(request));
    const challenge = await consumeChallenge('login', username);
    if (!challenge) throw new ApiError(400, 'Sign-in challenge expired or invalid');
    const credentialId = isoBase64URL.fromBuffer(isoBase64URL.toBuffer(response.id));
    const authenticator = authenticatorDB.findByCredentialId(credentialId);
    const user = challenge.userId === undefined ? undefined : userDB.findById(challenge.userId);
    if (!user || user.username !== username || !authenticator || authenticator.user_id !== user.id) {
      throw new ApiError(401, 'Passkey verification failed');
    }
    const { rpID, origin } = webauthnSettings();
    let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
    try {
      verification = await verifyAuthenticationResponse({
        response: response as unknown as AuthenticationResponseJSON,
        expectedChallenge: challenge.challenge, expectedOrigin: origin, expectedRPID: rpID,
        credential: {
          id: credentialId, publicKey: new Uint8Array(authenticator.credential_public_key),
          counter: authenticator.counter ?? 0,
        },
        requireUserVerification: true,
      });
    } catch { throw new ApiError(401, 'Passkey verification failed'); }
    if (!verification.verified) throw new ApiError(401, 'Passkey verification failed');
    getDatabase().transaction(() => {
      const current = authenticatorDB.findByCredentialId(credentialId);
      if (!current || (current.counter ?? 0) !== (authenticator.counter ?? 0)) throw new ApiError(401, 'Passkey changed. Please retry.');
      authenticatorDB.updateCounter(authenticator.id, verification.authenticationInfo.newCounter ?? 0);
    })();
    await createSession(user);
    return NextResponse.json({ success: true });
  }, { public: true });
}
