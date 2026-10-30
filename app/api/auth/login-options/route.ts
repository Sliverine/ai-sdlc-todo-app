import { NextRequest, NextResponse } from 'next/server';
import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { z } from 'zod';
import { ApiError, apiHandler, readJson } from '@/lib/api';
import { saveChallenge, webauthnSettings } from '@/lib/auth';
import { authenticatorDB, userDB } from '@/lib/db';
import { usernameSchema } from '@/lib/validation';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  return apiHandler(request, async () => {
    const { username } = z.object({ username: usernameSchema }).strict().parse(await readJson(request));
    const user = userDB.findByUsername(username);
    if (!user) throw new ApiError(400, 'Unable to start passkey sign-in');
    const { rpID } = webauthnSettings();
    const options = await generateAuthenticationOptions({
      rpID, userVerification: 'required',
      allowCredentials: authenticatorDB.findAllByUser(user.id).map((credential) => ({ id: credential.credential_id })),
    });
    await saveChallenge({ challenge: options.challenge, username, userId: user.id, flow: 'login' });
    return NextResponse.json(options);
  }, { public: true });
}
