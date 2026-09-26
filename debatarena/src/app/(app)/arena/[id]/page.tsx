import { ArenaLive } from "@/components/ArenaLive";

export default async function ArenaPage({ params, searchParams }: PageProps<"/arena/[id]">) {
  const { id } = await params;
  const q = await searchParams;
  return <ArenaLive id={id} listen={q.luister === "1"} />;
}
