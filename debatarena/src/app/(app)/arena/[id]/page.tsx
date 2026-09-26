import { ArenaLive } from "@/components/ArenaLive";

export default async function ArenaPage({ params }: PageProps<"/arena/[id]">) {
  const { id } = await params;
  return <ArenaLive id={id} />;
}
