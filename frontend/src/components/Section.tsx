"use client";

import { motion, useInView } from "framer-motion";
import { useRef } from "react";

/**
 * Section — Layer 2/3'te kullanılan kart wrapper.
 *
 * Viewport'a girdiğinde fade-up animasyonu (FRONTEND_PROMPT.md scroll
 * trigger). Stagger için dışarıdan `delay` geçilebilir.
 *
 * `id` verilirse smooth scroll target olur (chat overlay tetikler).
 */

export interface SectionProps {
  label: string;
  title: string;
  caption?: string;
  id?: string;
  delay?: number;
  highlighted?: boolean;
  children: React.ReactNode;
}

export function Section({
  label,
  title,
  caption,
  id,
  delay = 0,
  highlighted = false,
  children,
}: SectionProps) {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.2 });

  return (
    <motion.section
      ref={ref}
      id={id}
      initial={{ opacity: 0, y: 20 }}
      animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
      transition={{
        duration: 0.5,
        ease: [0.25, 0.8, 0.25, 1],
        delay,
      }}
      className={`card${highlighted ? " overlay-glow" : ""}`}
    >
      <div className="ui-label">{label}</div>
      <h2 className="font-serif text-2xl mb-2 tracking-tight">{title}</h2>
      {caption && (
        <p className="text-sm italic font-serif text-[color:var(--color-ink-500)] mb-6 max-w-2xl leading-relaxed">
          {caption}
        </p>
      )}
      <div className={caption ? "" : "mt-4"}>{children}</div>
    </motion.section>
  );
}
