import { ResultView } from "@/components/ResultView";

export default async function ResultPage({ params }: PageProps<"/resultaat/[id]">) {
  const { id } = await params;
  return <ResultView id={id} />;
}
