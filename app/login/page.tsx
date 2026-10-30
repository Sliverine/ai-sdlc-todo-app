"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { requestJson, responseError } from "@/lib/client-api";
import type { Session } from "@/lib/db";

type RegistrationOptions = Parameters<typeof startRegistration>[0]["optionsJSON"];
type AuthenticationOptions = Parameters<typeof startAuthentication>[0]["optionsJSON"];

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch("/api/auth/me").then(async (response) => {
      if (response.status === 401) return;
      if (!response.ok) throw new Error(await responseError(response));
      const current: Session = await response.json();
      if (active) setSession(current);
    }).catch((failure: unknown) => {
      if (active) setError(failure instanceof Error ? failure.message : "Could not check your session.");
    });
    return () => { active = false; };
  }, []);

  async function authenticate(register: boolean) {
    setError(null);
    setBusy(true);
    try {
      if (register) {
        const optionsJSON = await requestJson<RegistrationOptions>("/api/auth/register-options", {
          method: "POST", body: JSON.stringify({ username: session?.username ?? username.trim() }),
        });
        const response = await startRegistration({ optionsJSON });
        await requestJson("/api/auth/register-verify", {
          method: "POST", body: JSON.stringify({ username: session?.username ?? username.trim(), response }),
        });
      } else {
        const optionsJSON = await requestJson<AuthenticationOptions>("/api/auth/login-options", {
          method: "POST", body: JSON.stringify({ username: username.trim() }),
        });
        const response = await startAuthentication({ optionsJSON });
        await requestJson("/api/auth/login-verify", {
          method: "POST", body: JSON.stringify({ username: username.trim(), response }),
        });
      }
      router.replace("/");
    } catch (failure) {
      setError(failure instanceof Error && failure.name === "NotAllowedError"
        ? "Passkey prompt cancelled or timed out. You can try again."
        : failure instanceof Error ? failure.message : "Passkey authentication failed.");
    } finally { setBusy(false); }
  }

  return <main className="login">
    <h1>{session ? "Passkey settings" : "Welcome to Singapore Todo"}</h1>
    <p>{session ? "Add another passkey to your current account." : "Use a passkey. No password is required."}</p>
    {error && <p role="alert" className="error">{error}</p>}
    <form onSubmit={(event) => { event.preventDefault(); void authenticate(false); }}>
      {!session && <label>Username
        <input autoComplete="username webauthn" required value={username} onChange={(event) => setUsername(event.target.value)} />
      </label>}
      <div className="toolbar">
        {!session && <button type="submit" disabled={busy || !username.trim()}>Login</button>}
        <button type="button" className="secondary" disabled={busy || (!session && !username.trim())}
          onClick={() => void authenticate(true)}>{session ? "Add passkey" : "Register"}</button>
        {session && <Link href="/">Back to todos</Link>}
      </div>
      {busy && <p role="status">Waiting for your passkey...</p>}
    </form>
  </main>;
}
