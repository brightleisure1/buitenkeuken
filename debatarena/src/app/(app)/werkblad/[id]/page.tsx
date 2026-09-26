import { Werkblad } from "@/components/Werkblad";

export default async function WerkbladPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Werkblad id={id} />;
}
