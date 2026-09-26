"use client";

import { useEffect, useState } from "react";

const KONAMI = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];

export function useKonami() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let pos = 0;
    const h = (e: KeyboardEvent) => {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      pos = k === KONAMI[pos] ? pos + 1 : k === KONAMI[0] ? 1 : 0;
      if (pos === KONAMI.length) {
        setOn((v) => !v);
        pos = 0;
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  return on;
}

export function useLateNight() {
  const [late, setLate] = useState(false);
  useEffect(() => {
    const check = () => {
      const h = new Date().getHours();
      setLate(h >= 22 || h < 5);
    };
    check();
    const t = setInterval(check, 60_000);
    return () => clearInterval(t);
  }, []);
  return late;
}

export function usePortraitSize() {
  const [size, setSize] = useState(96);
  useEffect(() => {
    const f = () =>
      setSize(window.innerHeight < 700 ? 40 : window.innerWidth < 480 ? 50 : window.innerHeight < 820 || window.innerWidth < 900 ? 64 : 84);
    f();
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);
  return size;
}
