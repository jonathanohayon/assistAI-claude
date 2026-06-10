"use client";

import { motion, useReducedMotion, type Variants } from "motion/react";
import type { ReactNode } from "react";

/**
 * Primitives de motion partagées pour la landing — UN seul vocabulaire
 * d'animation pour toutes les sections (même easing, mêmes distances,
 * même rythme de stagger), sinon la page paraît décousue.
 *
 * Usage :
 *   <Reveal>…</Reveal>                  — fade-up au scroll (whileInView, once)
 *   <Stagger>                            — container qui orchestre ses enfants
 *     <StaggerItem>…</StaggerItem>
 *   </Stagger>
 */

/** Easing signature Tamara — expo-out doux, déjà utilisé dans le Hero. */
export const EASE = [0.16, 1, 0.3, 1] as const;

/** Viewport par défaut : déclenche un peu avant l'entrée complète, une fois. */
const VIEWPORT = { once: true, margin: "-12% 0px -12% 0px" } as const;

export function Reveal({
  children,
  delay = 0,
  y = 28,
  className,
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y, filter: "blur(6px)" }}
      whileInView={
        reduce
          ? { opacity: 1 }
          : { opacity: 1, y: 0, filter: "blur(0px)" }
      }
      viewport={VIEWPORT}
      transition={
        reduce
          ? { duration: 0.2 }
          : { duration: 0.7, delay, ease: EASE }
      }
    >
      {children}
    </motion.div>
  );
}

const staggerContainer: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.07, delayChildren: 0.1 } },
};

const staggerItem: Variants = {
  hidden: { opacity: 0, y: 22, filter: "blur(4px)" },
  visible: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.6, ease: EASE },
  },
};

const staggerItemReduced: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
};

export function Stagger({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      variants={staggerContainer}
      initial="hidden"
      whileInView="visible"
      viewport={VIEWPORT}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      variants={reduce ? staggerItemReduced : staggerItem}
    >
      {children}
    </motion.div>
  );
}
