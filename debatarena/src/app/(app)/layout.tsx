import { Nav } from "@/components/Nav";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Nav />
      <main className="flex-1 flex flex-col">{children}</main>
    </>
  );
}
