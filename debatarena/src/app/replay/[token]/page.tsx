import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ReplayPlayer } from "@/components/ReplayPlayer";
import { getMessages, getRunByToken } from "@/lib/runs";
import { applyShare } from "@/lib/text";
import type { Message, Role } from "@/lib/types";

export async function generateMetadata({ params }: PageProps<"/replay/[token]">): Promise<Metadata> {
  const { token } = await params;
  const run = await getRunByToken(token).catch(() => null);
  if (!run) return { title: "Debatarena" };
  const { fix } = applyShare(run.cast, [], run.share);
  const title = fix(run.title ?? run.question);
  const description = run.result ? fix(run.result.uitslag) : "Bekijk het debat terug.";
  return {
    title: `${title} · Debatarena`,
    description,
    openGraph: { title, description, images: [`/api/public/card/${token}?format=square`] },
    twitter: { card: "summary_large_image", images: [`/api/public/card/${token}?format=square`] },
  };
}

/** Publieke, alleen-lezen replay. Toont alleen wat nodig is om af te spelen. */
export default async function PublicReplay({ params }: PageProps<"/replay/[token]">) {
  const { token } = await params;
  const run = await getRunByToken(token).catch(() => null);
  if (!run) notFound();
  const all = await getMessages(run.id);
  const { cast, messages, fix } = applyShare(run.cast, all.filter((m) => m.kind !== "system"), run.share);

  const roles: Role[] = cast.rollen.map((r) => ({
    id: r.id,
    naam: r.naam,
    functie: r.functie,
    perspectief: "",
    instructie: "",
    zin: r.zin,
    modelKey: r.modelKey,
    customModel: r.customModel ?? null,
    ongezouten: r.ongezouten,
    stemId: null,
    webzoeken: false,
    isJury: r.isJury,
    isKritisch: r.isKritisch,
    uiterlijk: "",
  }));
  const safe: Message[] = messages.map((m) => ({ ...m, cost_eur: 0, audio: run.share.redactions?.length || run.share.anonymous ? [] : m.audio }));

  return (
    <main className="flex-1 flex flex-col">
      <ReplayPlayer
        fullHeight
        title={fix(run.title ?? run.question)}
        roles={roles}
        portraits={Object.fromEntries(cast.rollen.map((r) => [r.id, run.prep[r.id]?.portraits]))}
        messages={safe}
        highlights={run.highlights}
        rounds={run.cast.rondes}
        extra={
          <Link href="/" className="btn-primary !py-1.5 text-sm">
            Start je eigen debat
          </Link>
        }
      />
    </main>
  );
}
