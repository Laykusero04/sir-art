import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL")!;
const publishableKeys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}") as Record<string, string>;
const publishable = publishableKeys.default ?? Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const authHeader = request.headers.get("Authorization") ?? "";
  const userClient = createClient(url, publishable, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error } = await userClient.auth.getUser();
  if (error || !userData.user) return new Response("Sign in required.", { status: 401 });

  const body = await request.json();
  const { data, error: reportError } = await userClient.rpc("report_dataset", {
    p_type: body.type,
    p_school_year: body.schoolYearId ?? null,
    p_grading_period: body.gradingPeriodId ?? null,
    p_category: body.categoryId ?? null,
    p_grade_level: body.gradeLevelId ?? null,
    p_teacher: body.teacherId ?? null,
    p_status: body.status ?? null,
  });
  if (reportError) return new Response(reportError.message, { status: 400 });
  return Response.json(data);
});
