"use client";

import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { ErrorNotice } from "@/components/ui/Feedback";
import { ApiClientError, api, errorMessage } from "@/lib/api-client";

function safeNext(next: string | undefined): string {
  // Only same-site absolute paths: never an external URL or protocol-relative link.
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/dashboard";
}

interface FormState {
  loading: boolean;
  error: string | null;
  fields: Record<string, string>;
}

const INITIAL: FormState = { loading: false, error: null, fields: {} };

function useAuthSubmit(path: string, next?: string) {
  const router = useRouter();
  const [state, setState] = useState<FormState>(INITIAL);
  const submit = async (body: Record<string, unknown>) => {
    setState({ loading: true, error: null, fields: {} });
    try {
      await api(path, { method: "POST", body });
      router.replace(safeNext(next));
      router.refresh();
      return true;
    } catch (err) {
      setState({ loading: false, error: errorMessage(err), fields: err instanceof ApiClientError ? err.fieldErrors() : {} });
      return err instanceof ApiClientError ? err.code : "error";
    }
  };
  return { state, submit };
}

export function LoginForm({ next, registrationEnabled }: { next?: string; registrationEnabled: boolean }) {
  const { state, submit } = useAuthSubmit("/api/v1/auth/login", next);
  const [creds, setCreds] = useState<{ email: string; password: string } | null>(null);
  const [needCode, setNeedCode] = useState(false);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const email = String(data.get("email") ?? creds?.email ?? "");
    const password = String(data.get("password") ?? creds?.password ?? "");
    const code = String(data.get("code") ?? "").trim();
    const result = await submit({ email, password, ...(code ? { code } : {}) });
    if (result === "two_factor_required") {
      setCreds({ email, password });
      setNeedCode(true);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {state.error && !(needCode && !state.fields.code && state.error.startsWith("Enter the")) && <ErrorNotice>{state.error}</ErrorNotice>}
      {needCode ? (
        <>
          <p className="text-[13px] text-muted">
            Two-factor authentication is on for <span className="font-medium text-fg">{creds?.email}</span>. Enter the 6-digit code from your authenticator app, or one of your backup codes.
          </p>
          <Field label="Authentication code" hint="Codes change every 30 seconds. Backup codes work once each.">
            {(p) => <Input {...p} name="code" inputMode="text" autoComplete="one-time-code" autoFocus required maxLength={24} placeholder="123456" />}
          </Field>
          <Button type="submit" variant="primary" size="lg" full loading={state.loading}>
            Verify and sign in
          </Button>
          <button type="button" onClick={() => setNeedCode(false)} className="block w-full text-center text-[13px] text-muted hover:text-fg">
            Use a different account
          </button>
        </>
      ) : (
        <>
          <Field label="Email" error={state.fields.email}>
            {(p) => <Input {...p} name="email" type="email" autoComplete="email" required autoFocus />}
          </Field>
          <Field label="Password" error={state.fields.password}>
            {(p) => <Input {...p} name="password" type="password" autoComplete="current-password" required />}
          </Field>
          <div className="-mt-1 text-right">
            <Link href="/forgot-password" className="text-[13px] text-muted hover:text-fg hover:underline">
              Forgot your password?
            </Link>
          </div>
          <Button type="submit" variant="primary" size="lg" full loading={state.loading}>
            Sign in
          </Button>
          {registrationEnabled && (
            <p className="text-center text-[13px] text-muted">
              New here?{" "}
              <Link href={next ? `/register?next=${encodeURIComponent(next)}` : "/register"} className="font-medium text-accent hover:underline">
                Create an account
              </Link>
            </p>
          )}
        </>
      )}
    </form>
  );
}

export function RegisterForm({ next }: { next?: string }) {
  const { state, submit } = useAuthSubmit("/api/v1/auth/register", next);
  const [password, setPassword] = useState("");
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const displayName = String(data.get("displayName") ?? "").trim();
    void submit({ email: String(data.get("email") ?? ""), password, ...(displayName ? { displayName } : {}) });
  };
  const strength = password.length === 0 ? null : password.length < 10 ? "Too short" : password.length < 14 ? "OK" : "Strong";
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {state.error && <ErrorNotice>{state.error}</ErrorNotice>}
      <Field label="Name" optional>
        {(p) => <Input {...p} name="displayName" autoComplete="name" maxLength={60} />}
      </Field>
      <Field label="Email" error={state.fields.email}>
        {(p) => <Input {...p} name="email" type="email" autoComplete="email" required autoFocus />}
      </Field>
      <Field label="Password" error={state.fields.password} hint={strength ? `${strength}. Use at least 10 characters.` : "Use at least 10 characters."}>
        {(p) => <Input {...p} name="password" type="password" autoComplete="new-password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} />}
      </Field>
      <Button type="submit" variant="primary" size="lg" full loading={state.loading}>
        Create account
      </Button>
      <p className="text-center text-[13px] text-muted">
        Already have an account?{" "}
        <Link href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"} className="font-medium text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, setState] = useState<{ loading: boolean; sent: boolean; error: string | null }>({ loading: false, sent: false, error: null });
  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get("email") ?? "");
    setState({ loading: true, sent: false, error: null });
    try {
      await api("/api/v1/auth/forgot", { method: "POST", body: { email } });
      setState({ loading: false, sent: true, error: null });
    } catch (err) {
      setState({ loading: false, sent: false, error: errorMessage(err) });
    }
  };
  if (state.sent) {
    return (
      <div className="space-y-3 text-[13px] text-muted" role="status">
        <p className="flex items-start gap-2 text-fg">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
          If that address has an account, a reset link is on its way. It works for one hour and only once.
        </p>
        <p>
          Nothing arrived? This server may not have an email service set up. Ask an administrator for a recovery link. Otherwise check spam, then{" "}
          <button type="button" className="font-medium text-accent hover:underline" onClick={() => setState({ loading: false, sent: false, error: null })}>
            try again
          </button>
          .
        </p>
      </div>
    );
  }
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {state.error && <ErrorNotice>{state.error}</ErrorNotice>}
      <Field label="Email">{(p) => <Input {...p} name="email" type="email" autoComplete="email" required autoFocus />}</Field>
      <Button type="submit" variant="primary" size="lg" full loading={state.loading}>
        Send reset link
      </Button>
      <p className="text-center text-[13px] text-muted">
        <Link href="/login" className="font-medium text-accent hover:underline">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, setState] = useState<FormState & { done: boolean }>({ ...INITIAL, done: false });
  const [password, setPassword] = useState("");
  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setState({ ...INITIAL, loading: true, done: false });
    try {
      await api("/api/v1/auth/reset", { method: "POST", body: { token, password } });
      setState({ ...INITIAL, done: true });
    } catch (err) {
      setState({ loading: false, done: false, error: errorMessage(err), fields: err instanceof ApiClientError ? err.fieldErrors() : {} });
    }
  };
  if (state.done) {
    return (
      <div className="space-y-4" role="status">
        <p className="flex items-start gap-2 text-[13px] text-fg">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
          Your password was changed and every device was signed out.
        </p>
        <Link href="/login" className="inline-flex h-11 w-full items-center justify-center rounded-md bg-accent text-sm font-medium text-accent-fg hover:bg-accent-hover">
          Sign in
        </Link>
      </div>
    );
  }
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {state.error && <ErrorNotice>{state.error}</ErrorNotice>}
      <Field label="New password" error={state.fields.password} hint="At least 10 characters.">
        {(p) => <Input {...p} name="password" type="password" autoComplete="new-password" required minLength={10} autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />}
      </Field>
      <Button type="submit" variant="primary" size="lg" full loading={state.loading}>
        Change password
      </Button>
    </form>
  );
}

/** Confirms an email address as soon as the page opens (the link itself is the proof). */
export function VerifyEmailStatus({ token }: { token: string }) {
  const [state, setState] = useState<{ status: "working" | "ok" | "error"; message: string }>({ status: "working", message: "" });
  useEffect(() => {
    let cancelled = false;
    api("/api/v1/auth/verify-email", { method: "POST", body: { token } }).then(
      () => !cancelled && setState({ status: "ok", message: "" }),
      (err) => !cancelled && setState({ status: "error", message: errorMessage(err) }),
    );
    return () => {
      cancelled = true;
    };
  }, [token]);
  if (state.status === "working") return <p role="status" className="text-[13px] text-muted">Confirming your address…</p>;
  if (state.status === "error") return <ErrorNotice>{state.message}</ErrorNotice>;
  return (
    <p role="status" className="flex items-start gap-2 text-[13px] text-fg">
      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
      Your email address is confirmed.
    </p>
  );
}