import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex-1 grid place-items-center p-6 text-center">
      <div className="space-y-3">
        <h1 className="font-display text-4xl font-extrabold">Niets te zien hier</h1>
        <p className="text-ink/70">Deze pagina of link bestaat niet (meer). Misschien is het delen gestopt.</p>
        <Link href="/" className="btn-primary">
          Start je eigen debat
        </Link>
      </div>
    </main>
  );
}
