"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";

export default function ScreenShell({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className={`relative mx-auto flex h-dvh w-full max-w-4xl flex-col items-center justify-center overflow-y-auto overflow-x-hidden px-4 py-6 text-center text-dojo-washi-white sm:px-6 sm:py-8 ${className}`}
    >
      {children}
    </motion.div>
  );
}
