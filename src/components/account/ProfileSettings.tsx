"use client";

import { ImageUp, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/Field";
import { Avatar, ErrorNotice } from "@/components/ui/Feedback";
import { useToast } from "@/components/ui/Toast";
import { ApiClientError, api, errorMessage } from "@/lib/api-client";
import type { UserDto } from "@/lib/types";

interface Props {
  user: UserDto;
  languages: Array<{ code: string; label: string }>;
  privacy: { showEmail: boolean; showProfile: boolean };
}

const THEMES = [
  { value: "system", label: "Match my device" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

function applyTheme(theme: string) {
  if (theme === "light" || theme === "dark") {
    document.documentElement.dataset.theme = theme;
    document.cookie = `cairn_theme=${theme}; Path=/; Max-Age=31536000; SameSite=Lax`;
  } else {
    delete document.documentElement.dataset.theme;
    document.cookie = "cairn_theme=; Path=/; Max-Age=0; SameSite=Lax";
  }
}

export function AvatarEditor({ user }: { user: UserDto }) {
  const router = useRouter();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const res = await fetch("/api/v1/account/avatar", { method: "PUT", body: file, headers: { "content-type": file.type || "application/octet-stream" }, credentials: "same-origin" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? "That image couldn't be used.");
      }
      toast.success("Photo updated");
      router.refresh();
    } catch (err) {
      toast.error("Couldn't update your photo", errorMessage(err));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api("/api/v1/account/avatar", { method: "DELETE" });
      toast.success("Photo removed");
      router.refresh();
    } catch (err) {
      toast.error("Couldn't remove your photo", errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-4">
      <Avatar name={user.displayName} src={user.avatarUrl} className="size-16 text-lg" />
      <div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" loading={busy} onClick={() => input.current?.click()} icon={<ImageUp className="size-4" aria-hidden />}>
            {user.avatarUrl ? "Replace photo" : "Upload photo"}
          </Button>
          {user.avatarUrl && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={remove} icon={<Trash2 className="size-4" aria-hidden />}>
              Remove
            </Button>
          )}
        </div>
        <p className="mt-1.5 text-xs text-subtle">JPEG, PNG, WebP, GIF or AVIF up to 5 MB. It&apos;s resized and re-encoded on our side.</p>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" className="sr-only" tabIndex={-1} aria-label="Choose a profile photo" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
      </div>
    </div>
  );
}

export function ProfileSettings({ user, languages, privacy }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState({
    displayName: user.displayName,
    username: user.username ?? "",
    bio: user.bio,
    timezone: user.timezone,
    language: user.language,
    theme: user.theme,
    showEmail: privacy.showEmail,
    showProfile: privacy.showProfile,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const zones = useMemo(() => {
    let list: string[] = [];
    try {
      list = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
    } catch {
      /* older engines */
    }
    if (!list.includes("UTC")) list = ["UTC", ...list];
    if (user.timezone && !list.includes(user.timezone)) list = [user.timezone, ...list];
    return list;
  }, [user.timezone]);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const dirty =
    form.displayName !== user.displayName ||
    form.username !== (user.username ?? "") ||
    form.bio !== user.bio ||
    form.timezone !== user.timezone ||
    form.language !== user.language ||
    form.theme !== user.theme ||
    form.showEmail !== privacy.showEmail ||
    form.showProfile !== privacy.showProfile;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    try {
      await api("/api/v1/account/profile", {
        method: "PATCH",
        body: {
          displayName: form.displayName,
          username: form.username.trim() ? form.username : null,
          bio: form.bio,
          timezone: form.timezone,
          language: form.language,
          theme: form.theme,
          privacy: { showEmail: form.showEmail, showProfile: form.showProfile },
        },
      });
      applyTheme(form.theme);
      document.documentElement.dataset.tz = form.timezone;
      toast.success("Profile saved");
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiClientError) setFields(err.fieldErrors());
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Display name" error={fields.displayName}>
          {(p) => <Input {...p} value={form.displayName} maxLength={60} required onChange={(e) => set("displayName", e.target.value)} />}
        </Field>
        <Field label="Username" optional error={fields.username} hint="3–30 letters, digits, _ or -.">
          {(p) => <Input {...p} value={form.username} maxLength={30} autoComplete="username" onChange={(e) => set("username", e.target.value)} />}
        </Field>
      </div>
      <Field label="Email" hint="Change your email under Security.">
        {(p) => <Input {...p} value={user.email} readOnly disabled />}
      </Field>
      <Field label="About you" optional hint={`${form.bio.length}/300`}>
        {(p) => <Textarea {...p} rows={3} maxLength={300} value={form.bio} onChange={(e) => set("bio", e.target.value)} />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Time zone" hint="Dates and times in the app are shown in this zone.">
          {(p) => (
            <Select {...p} value={form.timezone} onChange={(e) => set("timezone", e.target.value)}>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z.replaceAll("_", " ")}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Language">
          {(p) => (
            <Select {...p} value={form.language} onChange={(e) => set("language", e.target.value)}>
              {languages.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Theme">
          {(p) => (
            <Select {...p} value={form.theme} onChange={(e) => set("theme", e.target.value)}>
              {THEMES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <fieldset className="space-y-2">
        <legend className="mb-1 text-[13px] font-medium">Privacy</legend>
        <Checkbox label="Show my email to people I share with and to organization members" checked={form.showEmail} onChange={(e) => set("showEmail", e.target.checked)} />
        <Checkbox label="Let organization members see my profile page" checked={form.showProfile} onChange={(e) => set("showProfile", e.target.checked)} />
      </fieldset>
      <Button type="submit" variant="primary" loading={busy} disabled={!dirty || !form.displayName.trim()}>
        Save changes
      </Button>
    </form>
  );
}
