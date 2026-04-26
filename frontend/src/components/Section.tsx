"use client";

import { motion } from "framer-motion";

/**
 * Section — Layer 2/3'te kullanılan kart wrapper.
 *
 * Sayfa mount'unda fade-up animasyonu. Eskiden scroll-trigger
 * (useInView) kullanılıyordu ama aşağıdaki section'lar kullanıcı scroll
 * yapana kadar opacity:0 kalıyordu — "ilk açılışta dashboard'ların yarısı
 * gözükmüyor" sorununa yol açıyordu. Şimdi mount'ta tüm section'lar
 * görünür hâle geliyor; stagger için `delay` korundu.
 *
 * `id` verilirse smooth scroll target olur (chat overlay tetikler).
 */

export interface SectionProps {
  /** Backwards-compat: artık görsel olarak render edilmiyor (kullanıcı isteği). */
  label?: string;
  title: string;
  caption?: string;
  id?: string;
  delay?: number;
  highlighted?: boolean;
  children: React.ReactNode;
}

export function Section({
  title,
  caption,
  id,
  delay = 0,
  highlighted = false,
  children,
}: SectionProps) {
  return (
    <motion.section
      id={id}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.4,
        ease: [0.25, 0.8, 0.25, 1],
        delay,
      }}
      className={`card${highlighted ? " overlay-glow" : ""}`}
    >
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
