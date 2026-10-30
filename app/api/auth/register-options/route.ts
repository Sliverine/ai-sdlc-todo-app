import { NextRequest, NextResponse } from 'next/server';
import { generateRegistrationOptions } from '@simplewebauthn/server';
import { z } from 'zod';
import { ApiError, apiHandler, readJson } from '@/lib/api';
import { saveChallenge, webauthnSettings, webauthnUserID } from '@/lib/auth';
import { authenticatorDB, userDB } from '@/lib/db';
import { usernameSchema } from '@/lib/validation';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  return apiHandler(request, async (session) => {
    const { username } = z.object({ username: usernameSchema }).strict().parse(await readJson(request));
    if (session && session.username !== username) throw new ApiError(403, 'Passkeys must be added to your own account');
    const existing = userDB.findByUsername(username);
    if (existing && existing.id !== session?.userId) throw new ApiError(409, 'Username already taken');
    const { rpID, rpName } = webauthnSettings();
    const options = await generateRegistrationOptions({
      rpID, rpName, userName: username, userID: webauthnUserID(username), attestationType: 'none',
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
      excludeCredentials: existing ? authenticatorDB.findAllByUser(existing.id).map((credential) => ({ id: credential.credential_id })) : [],
    });
    await saveChallenge({ challenge: options.challenge, username, flow: 'register', userId: existing?.id });
    return NextResponse.json(options);
  }, { public: true });
}
