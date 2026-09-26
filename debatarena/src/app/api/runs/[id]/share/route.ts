import { randomToken } from "@/lib/crypto";
import { body, handle } from "@/lib/route";
import { getRun, updateRun } from "@/lib/runs";
import type { ShareSettings } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

/** Deel-instellingen opslaan en (indien nodig) een publieke replay-link maken. */
export const POST = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const input = await body<ShareSettings & { publish?: boolean }>(req);
  const run = await getRun(id);
  const share: ShareSettings = {
    redactions: (input.redactions ?? run.share.redactions ?? []).map((w) => w.trim()).filter(Boolean).slice(0, 50),
    anonymous: input.anonymous ?? run.share.anonymous ?? false,
  };
  const token = input.publish ? (run.share_token ?? randomToken()) : run.share_token;
  await updateRun(id, { share, share_token: token });
  return Response.json({ share, token });
});

/** Stop met delen: de link werkt daarna niet meer. */
export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  await updateRun(id, { share_token: null });
  return Response.json({ ok: true });
});
