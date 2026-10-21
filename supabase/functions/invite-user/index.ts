import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const secret = firstKey(Deno.env.get("SUPABASE_SECRET_KEYS"), [
  Deno.env.get("SUPABASE_SECRET_KEY"),
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
]);
const publishable = firstKey(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS"), [
  Deno.env.get("SUPABASE_ANON_KEY"),
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY"),
]);

const roles = new Set(["teacher"]);
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type AuthError = { message?: string; code?: string } | null;

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!url || !secret || !publishable) return json({ error: "Invite service is not configured." }, 500);

  const authHeader = request.headers.get("Authorization") ?? "";
  const userClient = createClient(url, publishable, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json({ error: "Sign in required." }, 401);

  const { data: caller } = await userClient.from("profiles").select("role, school_id").eq("id", userData.user.id).single();
  if (caller?.role !== "principal") return json({ error: "Only the principal can invite a teacher." }, 403);
  if (!caller.school_id) return json({ error: "Your account is not attached to a school." }, 400);

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return json({ error: "Name, email, and role are required." }, 400);
  const email = String(body.email ?? "").trim().toLowerCase();
  const fullName = String(body.full_name ?? "").trim();
  const role = String(body.role ?? "");
  const redirectTo = passwordRedirect(body.redirect_to);
  if (!email || !fullName || !roles.has(role)) return json({ error: "A teacher name and email are required." }, 400);

  const admin = createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: existing } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
  if (existing) return json({ error: "This email already has an account." }, 400);

  const invited = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName },
    redirectTo,
  });

  let userId = invited.data.user?.id ?? null;
  let emailed = Boolean(userId);
  let inviteUrl: string | null = null;
  let createdNow = Boolean(userId);

  if (!userId) {
    const linked = await linkFor(admin, email, fullName, redirectTo, invited.error);
    if ("error" in linked) return json({ error: linked.error }, 400);
    userId = linked.userId;
    inviteUrl = linked.inviteUrl;
    emailed = false;
    createdNow = linked.createdNow;
  }

  const { error: profileError } = await admin.from("profiles").insert({
    id: userId,
    school_id: caller.school_id,
    full_name: fullName,
    email,
    role,
    is_active: true,
  });
  if (profileError) {
    if (createdNow) await admin.auth.admin.deleteUser(userId);
    const message = profileError.code === "23505" ? "This email already has an account." : profileError.message;
    return json({ error: message }, 400);
  }

  await admin.from("audit_logs").insert({
    school_id: caller.school_id,
    actor_id: userData.user.id,
    action: "user_created",
    entity_type: "profile",
    entity_id: userId,
    details: { role, email, emailed },
  });

  return json({ id: userId, emailed, invite_url: inviteUrl });
});

async function linkFor(
  admin: ReturnType<typeof createClient>,
  email: string,
  fullName: string,
  redirectTo: string | undefined,
  inviteError: AuthError,
) {
  if (!mailerBlocked(inviteError) && !alreadyRegistered(inviteError)) {
    return { error: inviteError?.message ?? "Invite failed." };
  }

  if (mailerBlocked(inviteError)) {
    const created = await admin.auth.admin.generateLink({
      type: "invite",
      email,
      options: { data: { full_name: fullName }, redirectTo },
    });
    const userId = created.data.user?.id;
    const inviteUrl = created.data.properties?.action_link ?? null;
    if (userId && inviteUrl) return { userId, inviteUrl, createdNow: true };
    if (!alreadyRegistered(created.error) && !alreadyRegistered(inviteError)) {
      return { error: created.error?.message ?? inviteError?.message ?? "Invite failed." };
    }
  }

  const recovery = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo },
  });
  const userId = recovery.data.user?.id;
  const inviteUrl = recovery.data.properties?.action_link ?? null;
  if (!userId || !inviteUrl) return { error: recovery.error?.message ?? "Invite failed." };
  return { userId, inviteUrl, createdNow: false };
}

function mailerBlocked(error: AuthError) {
  if (!error) return false;
  const message = error.message?.toLowerCase() ?? "";
  return error.code === "email_address_invalid"
    || error.code === "over_email_send_rate_limit"
    || message.includes("sending invite")
    || message.includes("error sending")
    || message.includes("smtp");
}

function alreadyRegistered(error: AuthError) {
  const message = error?.message?.toLowerCase() ?? "";
  return error?.code === "email_exists" || message.includes("already");
}

function passwordRedirect(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return undefined;
  try {
    const target = new URL(raw);
    if (target.protocol !== "http:" && target.protocol !== "https:") return undefined;
    if (target.pathname !== "/reset-password") return undefined;
    target.search = "";
    target.hash = "";
    return target.toString();
  } catch {
    return undefined;
  }
}

function firstKey(raw: string | undefined, fallbacks: Array<string | undefined>) {
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, string>;
      if (parsed.default) return parsed.default;
    } catch {
      if (!raw.startsWith("{")) return raw;
    }
  }
  return fallbacks.find((value) => value) ?? "";
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
