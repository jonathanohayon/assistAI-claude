"use client";

import { MotionConfig } from "motion/react";

// Components pick up the user's reduce-motion preference only after
// hydration (useReducedMotionAfterMount). Until then, this keeps every
// framer-motion animation on the landing free of transforms for those users.
export function RespectReducedMotion({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
