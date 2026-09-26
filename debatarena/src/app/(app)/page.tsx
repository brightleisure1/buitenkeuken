import { Suspense } from "react";
import { StartScreen } from "@/components/StartScreen";

export default function StartPage() {
  return (
    <Suspense>
      <StartScreen />
    </Suspense>
  );
}
