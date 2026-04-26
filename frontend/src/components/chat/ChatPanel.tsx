"use client";

/**
 * ChatPanel — Sağ alt fixed pill, tıklayınca:
 *   • Desktop: 420×600 modal (sağ alt)
 *   • Mobile: bottom sheet (full width, %85 yükseklik)
 *
 * Framer Motion ile slide-up + scale animasyonları.
 *
 * `dashboard_update` varsa OverlayProvider'a iletilir → ilgili dashboard
 * bileşeni 30s parlatılır + smooth scroll.
 *
 * Kısayol: '/' tuşu = aç + focus, ESC = kapat.
 */

import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Minus, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";
import type {
  AggregateResult,
  ChatResponse,
  Citation,
  DashboardUpdate,
  Recommendation,
} from "@/lib/types";
import { useOverlay } from "@/lib/use-overlay";
import { useSelection, uniColor, uniShortName } from "@/lib/use-selection";

const SUGGESTIONS = [
  "Hangi üniversitede en çok profesör var?",
  "AI alanında en çok ders sunan 5 üniversite",
  "8000 sıralamayla yapay zekada hangi üniversite uygun?",
  "Bilkent Üniversitesi'nin yazılım mühendisliği derslerini özetle",
];

interface UserMsg {
  role: "user";
  text: string;
}
interface AssistantMsg {
  role: "assistant";
  text: string;
  citations: Citation[];
  followUps: string[];
  recommendation?: Recommendation | null;
  aggregate?: AggregateResult | null;
  meta?: ChatResponse["meta"];
  /** typewriter effect için — false: hâlâ yazılıyor, true: tam göründü */
  done: boolean;
}
interface LoadingMsg {
  role: "loading";
}
type Msg = UserMsg | AssistantMsg | LoadingMsg;

export function ChatPanel() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { setOverlay } = useOverlay();
  const { selection, setSelection } = useSelection();
  // Açık/kapalı + minimize: panel açıkken minimize edildiğinde sadece
  // header satırı görünür kalır, mesajlar/input gizlenir.
  const [minimized, setMinimized] = useState(false);

  // Auto-scroll mesajların altına
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  // '/' kısayol
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "/" && (e.target as HTMLElement)?.tagName !== "INPUT") {
        e.preventDefault();
        setOpen(true);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
      if (e.key === "Escape" && open) setOpen(false);
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open]);

  const submit = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (q.length < 3) return;
      setInput("");
      setMessages((m) => [...m, { role: "user", text: q }, { role: "loading" }]);

      try {
        // Konuşma geçmişi: son 6 turn (3 user + 3 assistant). Çok eski
        // mesajlar context'i şişirmesin diye kesilir.
        const history = messages
          .filter(
            (m): m is UserMsg | (AssistantMsg & { done: true }) =>
              m.role === "user" || (m.role === "assistant" && m.done)
          )
          .slice(-6)
          .map((m) => ({
            role: m.role,
            text: m.text,
          }));
        // YKS sıralaması: kullanıcı isterse soru metnine yazar (router parser
        // 8000 / "8 bin" / "8.000 sıralamayla" formatlarını yakalıyor).
        const resp: ChatResponse = await api.chat(q, {
          selectedSlugs: selection.slugs,
          history,
        });
        // Cevabı önce boş text + done=false ile ekle, sonra typewriter
        // ile karakter karakter doldur (DASHBOARD_PROMPT "streaming" — gerçek
        // SSE değil, client-side simülasyon. Token sayısı az, doğal hızda).
        setMessages((m) => {
          const without = m.filter((x) => x.role !== "loading");
          return [
            ...without,
            {
              role: "assistant",
              text: "",
              citations: resp.citations || [],
              followUps: resp.follow_up_suggestions || [],
              recommendation: resp.recommendation || null,
              aggregate: resp.aggregate || null,
              meta: resp.meta,
              done: false,
            },
          ];
        });
        await typewriter(resp.text, (partial) => {
          setMessages((m) => {
            const copy = [...m];
            for (let i = copy.length - 1; i >= 0; i--) {
              const x = copy[i];
              if (x.role === "assistant" && !x.done) {
                copy[i] = { ...x, text: partial };
                break;
              }
            }
            return copy;
          });
        });
        setMessages((m) => {
          const copy = [...m];
          for (let i = copy.length - 1; i >= 0; i--) {
            const x = copy[i];
            if (x.role === "assistant" && !x.done) {
              copy[i] = { ...x, done: true };
              break;
            }
          }
          return copy;
        });
        // Overlay tetikle (30s)
        if (resp.dashboard_update) {
          applyOverlay(resp.dashboard_update, setOverlay);
        }
      } catch (e) {
        setMessages((m) => {
          const without = m.filter((x) => x.role !== "loading");
          return [
            ...without,
            {
              role: "assistant",
              text:
                "Üzgünüm, sistemde bir hata oluştu. Birazdan tekrar deneyebilir misin?",
              citations: [],
              followUps: [],
              done: true,
            },
          ];
        });
        console.error("Chat hatası:", e);
      }
    },
    [setOverlay, selection.slugs]
  );

  /** Recommendation kartından "ödev olarak seç" — slug'ları a/b/c'ye yansıt. */
  const applyRecommendation = useCallback(
    (slugs: string[]) => {
      if (slugs.length === 0) return;
      setSelection({
        a: slugs[0] || selection.a,
        b: slugs[1] || selection.b,
        c: slugs[2] || null,
      });
    },
    [selection.a, selection.b, setSelection]
  );

  return (
    <>
      {/* Pill */}
      <AnimatePresence>
        {!open && (
          <motion.button
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.2 }}
            onClick={() => setOpen(true)}
            className="fixed bottom-6 right-6 z-40 inline-flex items-center gap-2 rounded-full pl-3 pr-4 py-3 text-sm font-medium border bg-[color:var(--color-white-paper)] hover:shadow-raised transition-shadow"
            style={{
              borderColor: "var(--color-line)",
              boxShadow: "var(--shadow-paper)",
            }}
            aria-label="Müfredat asistanını aç (kısayol: /)"
          >
            <Sparkles size={16} strokeWidth={1.5} className="text-[color:var(--color-uni-b)]" />
            <span>Müfredat hakkında sor</span>
            <kbd className="ml-1 font-mono text-[10px] px-1.5 py-0.5 rounded bg-[color:var(--color-paper-2)] text-[color:var(--color-ink-500)] tabular-nums">
              /
            </kbd>
          </motion.button>
        )}
      </AnimatePresence>

      {/* Modal — desktop: sağ alt pencere; mobile: bottom sheet */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-40 sm:bg-transparent bg-[color:rgba(15,14,13,0.30)] sm:pointer-events-none"
            onClick={(e) => {
              if (e.target === e.currentTarget) setOpen(false);
            }}
          >
            <motion.div
              role="dialog"
              aria-label="AI asistan"
              aria-modal="true"
              initial={{ opacity: 0, y: 24, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 24, scale: 0.96 }}
              transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
              className={`fixed bottom-0 right-0 sm:bottom-6 sm:right-6 sm:pointer-events-auto pointer-events-auto w-full sm:w-[480px] sm:max-w-[calc(100vw-32px)] flex flex-col rounded-t-xl sm:rounded-lg overflow-hidden bg-[color:var(--color-white-paper)] border ${
                minimized ? "h-auto sm:h-auto" : "h-[88vh] sm:h-[700px] sm:max-h-[calc(100vh-48px)]"
              }`}
              style={{
                borderColor: "var(--color-line)",
                boxShadow: "var(--shadow-modal)",
              }}
            >
              {/* Header — tıklanınca minimize/expand */}
              <header
                className="flex items-center justify-between px-4 py-3 border-b cursor-pointer select-none"
                style={{ borderColor: "var(--color-line)" }}
                onClick={() => setMinimized((m) => !m)}
                role="button"
                aria-label={minimized ? "Asistanı genişlet" : "Asistanı küçült"}
                title={minimized ? "Genişlet" : "Küçült"}
              >
                <div className="flex items-center gap-2">
                  <Sparkles size={16} strokeWidth={1.5} className="text-[color:var(--color-uni-b)]" />
                  <span className="font-serif text-base">Asistan</span>
                  {minimized && messages.length > 0 && (
                    <span className="text-xs text-[color:var(--color-ink-500)] font-mono ml-1">
                      ({messages.filter((m) => m.role === "user").length} soru)
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setMinimized((m) => !m);
                    }}
                    className="p-1.5 text-[color:var(--color-ink-500)] hover:text-[color:var(--color-ink-900)] transition-colors"
                    aria-label={minimized ? "Genişlet" : "Küçült"}
                  >
                    <Minus size={14} strokeWidth={1.5} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpen(false);
                      setMinimized(false);
                    }}
                    className="p-1.5 -mr-1 text-[color:var(--color-ink-500)] hover:text-[color:var(--color-ink-900)] transition-colors"
                    aria-label="Kapat"
                  >
                    <X size={16} strokeWidth={1.5} />
                  </button>
                </div>
              </header>

              {!minimized && (
                <>
                  {/* Messages */}
                  <div
                    ref={scrollRef}
                    className="flex-1 overflow-y-auto px-4 py-4 space-y-3"
                    aria-live="polite"
                  >
                    {messages.length === 0 && <Welcome onPick={submit} />}
                    {messages.map((m, i) => (
                      <MessageBubble
                        key={i}
                        msg={m}
                        onPickFollowUp={submit}
                        onApplyRecommendation={applyRecommendation}
                      />
                    ))}
                  </div>
                </>
              )}

              {/* Input — minimize edildiğinde gizli */}
              {!minimized && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    submit(input);
                  }}
                  className="border-t px-3 py-3 flex items-center gap-2"
                  style={{ borderColor: "var(--color-line)" }}
                >
                  <input
                    ref={inputRef}
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Müfredat hakkında sor..."
                    aria-label="Soru"
                    className="flex-1 bg-[color:var(--color-paper-2)] rounded-md px-3 h-10 text-sm outline-none border focus:border-[color:var(--color-ink-700)] transition-colors"
                    style={{ borderColor: "var(--color-line)" }}
                    maxLength={500}
                  />
                  <button
                    type="submit"
                    disabled={input.trim().length < 3}
                    className="h-10 w-10 flex items-center justify-center rounded-md bg-[color:var(--color-ink-900)] text-[color:var(--color-paper)] disabled:opacity-30 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
                    aria-label="Gönder"
                  >
                    <ArrowRight size={16} strokeWidth={1.5} />
                  </button>
                </form>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function Welcome({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="space-y-4">
      <p className="text-sm font-serif italic leading-relaxed text-[color:var(--color-ink-700)]">
        Merhaba — Türk üniversitelerinin bilgisayar / yazılım / YBS
        müfredatları hakkında sorabilirsin. Seçim zorunlu değil — istediğin
        üniversite veya bölümü doğrudan adıyla ya da YKS sıralamanla yaz.
      </p>
      <div className="space-y-2">
        <p className="ui-label">Önerilen sorular</p>
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className="w-full text-left px-3 py-2.5 rounded-md text-sm bg-[color:var(--color-paper-2)] hover:bg-[color:var(--color-paper-3)] transition-colors flex items-center justify-between gap-2 group"
          >
            <span className="flex-1">{s}</span>
            <ArrowRight
              size={14}
              className="text-[color:var(--color-ink-300)] group-hover:text-[color:var(--color-ink-900)] group-hover:translate-x-0.5 transition-all"
            />
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({
  msg,
  onPickFollowUp,
  onApplyRecommendation,
}: {
  msg: Msg;
  onPickFollowUp: (q: string) => void;
  onApplyRecommendation: (slugs: string[]) => void;
}) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] bg-[color:var(--color-paper-3)] rounded-lg px-3 py-2 text-sm">
          {msg.text}
        </div>
      </div>
    );
  }

  if (msg.role === "loading") {
    return (
      <div className="flex justify-start">
        <div className="bg-[color:var(--color-paper-2)] rounded-lg px-4 py-3 flex gap-1.5">
          {[0, 150, 300].map((d) => (
            <span
              key={d}
              className="w-1.5 h-1.5 rounded-full bg-[color:var(--color-ink-500)] animate-pulse"
              style={{ animationDelay: `${d}ms` }}
            />
          ))}
        </div>
      </div>
    );
  }

  // assistant
  const showSupporting = msg.done;
  return (
    <div className="space-y-2">
      <div
        className="max-w-[90%] rounded-lg px-3 py-2.5 text-sm leading-relaxed border bg-[color:var(--color-white-paper)]"
        style={{ borderColor: "var(--color-line)" }}
      >
        <RichText text={msg.text} />
        {!msg.done && (
          <span
            aria-hidden
            className="inline-block w-[2px] h-[1em] ml-0.5 align-text-bottom bg-[color:var(--color-ink-700)] animate-pulse"
          />
        )}
      </div>

      {showSupporting && msg.citations.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="flex flex-wrap gap-1.5 ml-1"
        >
          {msg.citations.map((c, i) => (
            <a
              key={i}
              href={c.url || undefined}
              target={c.url ? "_blank" : undefined}
              rel="noreferrer"
              className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-sm bg-[color:rgba(45,106,138,0.10)] text-[color:var(--color-info)] hover:bg-[color:rgba(45,106,138,0.20)] transition-colors"
              title={`${c.name || ""}${c.university ? ` — ${c.university}` : ""}`}
            >
              {c.code}
            </a>
          ))}
        </motion.div>
      )}

      {showSupporting && msg.aggregate && msg.aggregate.ranked.length > 0 && (
        <AggregateBars data={msg.aggregate} />
      )}

      {showSupporting && msg.recommendation && msg.recommendation.ranked.length > 0 && (
        <RecommendationCard
          rec={msg.recommendation}
          onApply={onApplyRecommendation}
        />
      )}

      {showSupporting && msg.followUps.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
          className="space-y-1 ml-1 pt-1"
        >
          {msg.followUps.map((s) => (
            <button
              key={s}
              onClick={() => onPickFollowUp(s)}
              className="block text-left text-xs italic text-[color:var(--color-ink-500)] hover:text-[color:var(--color-ink-900)] transition-colors"
            >
              ↳ {s}
            </button>
          ))}
        </motion.div>
      )}

      {showSupporting && msg.meta && (
        <div className="ml-1 text-[10px] font-mono text-[color:var(--color-ink-300)]">
          {msg.meta.intent_type} · {msg.meta.latency_ms}ms · ${msg.meta.llm.cost_usd.toFixed(4)}
        </div>
      )}
    </div>
  );
}

/**
 * AggregateBars — Aggregate intent cevabında inline mini bar chart.
 *
 * Her satır: üniversite adı + sayı + sayıya orantılı bar.
 * En yüksek değer 100% genişlik = referans, diğerleri ona göre normalize.
 * "asc" sıralamada (örn YKS başarı sırası) düşük değer = uzun bar
 * mantıksız olur — bu durumda min'i baz alıp invert ederiz.
 */
function AggregateBars({ data }: { data: AggregateResult }) {
  if (!data.ranked.length) return null;
  const values = data.ranked.map((r) => r.value);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const isAsc = data.order === "asc";
  // asc'de görsel olarak en küçük değer en uzun bar (1.0)
  const widthFor = (v: number): number => {
    if (max === min) return 1;
    if (isAsc) return (max - v) / (max - min || 1);
    return v / (max || 1);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.05 }}
      className="rounded-lg border bg-[color:var(--color-paper-2)] px-3 py-2.5 ml-1 space-y-2"
      style={{ borderColor: "var(--color-line)" }}
    >
      <div className="ui-label">{data.metric_label}</div>
      <ul className="space-y-1.5">
        {data.ranked.map((row, idx) => {
          const w = Math.max(0.06, widthFor(row.value)) * 100;
          const isTop = idx === 0;
          return (
            <li key={row.slug} className="text-xs">
              <div className="flex items-baseline justify-between gap-2 mb-0.5">
                <span
                  className={`truncate flex-1 ${
                    isTop ? "font-medium" : ""
                  }`}
                >
                  {row.name}
                </span>
                <span className="font-mono tabular-nums text-[color:var(--color-ink-700)] flex-shrink-0">
                  {Number.isInteger(row.value)
                    ? row.value.toLocaleString("tr-TR")
                    : row.value.toFixed(1)}
                </span>
              </div>
              <div
                className="h-1.5 rounded-full overflow-hidden"
                style={{ background: "var(--color-paper-3)" }}
              >
                <div
                  className="h-full transition-all duration-500"
                  style={{
                    width: `${w}%`,
                    background: isTop
                      ? "var(--color-uni-a)"
                      : hexAlphaSafe("var(--color-uni-a)", 0.5),
                  }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </motion.div>
  );
}

function hexAlphaSafe(color: string, alpha: number): string {
  return `color-mix(in srgb, ${color} ${Math.round(alpha * 100)}%, transparent)`;
}

/**
 * RecommendationCard — Advisory cevabında yapılandırılmış öneri kartı.
 * Top pick vurgulanır, alternatifler altında ufak satırlar olarak listelenir.
 * "Karşılaştırmaya al" butonu — kullanıcı önerilen 3 üniversiteyi
 * dashboard'da yan yana açar (a/b/c slot'larına yansır).
 */
function RecommendationCard({
  rec,
  onApply,
}: {
  rec: Recommendation;
  onApply: (slugs: string[]) => void;
}) {
  const top = rec.ranked.find((r) => r.slug === rec.top_pick) || rec.ranked[0];
  const others = rec.ranked.filter((r) => r.slug !== top?.slug).slice(0, 4);
  const allSlugs = [top, ...others].filter(Boolean).map((r) => r!.slug).slice(0, 3);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: 0.05 }}
      className="rounded-lg border bg-[color:var(--color-paper-2)] px-3 py-3 ml-1 space-y-2.5"
      style={{ borderColor: "var(--color-line)" }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="ui-label">Tavsiye · veriye dayalı</div>
        <button
          onClick={() => onApply(allSlugs)}
          className="text-[11px] font-mono uppercase tracking-wider px-2 py-1 rounded bg-[color:var(--color-ink-900)] text-[color:var(--color-paper)] hover:opacity-90 transition-opacity"
        >
          karşılaştırmaya al →
        </button>
      </div>

      {top && (
        <div
          className="border-l-2 pl-3 py-1"
          style={{ borderColor: uniColor(0) }}
        >
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <span className="font-serif text-sm font-medium leading-tight">
              {uniShortName(top.slug, top.name)}
            </span>
            <span className="font-mono text-[11px] tabular-nums text-[color:var(--color-ink-500)]">
              uyum %{top.fit_score}
            </span>
          </div>
          {top.reasons.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-xs text-[color:var(--color-ink-700)] leading-snug">
              {top.reasons.slice(0, 3).map((r, i) => (
                <li key={i}>· {r}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {others.length > 0 && (
        <div className="space-y-1.5">
          <div className="ui-label text-[9px]">Alternatifler</div>
          {others.map((r, idx) => (
            <div
              key={r.slug}
              className="flex items-baseline justify-between gap-2 text-xs"
            >
              <span className="flex items-baseline gap-1.5 min-w-0">
                <span
                  aria-hidden
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ background: uniColor(idx + 1 < 3 ? idx + 1 : 2) }}
                />
                <span className="font-medium truncate">
                  {uniShortName(r.slug, r.name)}
                </span>
                <span className="text-[color:var(--color-ink-500)] truncate">
                  · {r.reasons[0] || ""}
                </span>
              </span>
              <span className="font-mono text-[10px] tabular-nums text-[color:var(--color-ink-500)] flex-shrink-0">
                %{r.fit_score}
              </span>
            </div>
          ))}
        </div>
      )}

      {rec.rationale && (
        <p className="text-[11px] italic font-serif text-[color:var(--color-ink-500)] leading-snug pt-1 border-t" style={{ borderColor: "var(--color-line)" }}>
          {rec.rationale}
        </p>
      )}
    </motion.div>
  );
}

/** <ref>CODE</ref> tag'lerini chip olarak render et. */
function RichText({ text }: { text: string }) {
  const parts = text.split(/(<ref>.*?<\/ref>)/g);
  return (
    <>
      {parts.map((p, i) => {
        const m = /^<ref>(.*?)<\/ref>$/.exec(p);
        if (m) {
          return (
            <code
              key={i}
              className="font-mono text-[0.85em] px-1.5 py-0.5 rounded bg-[color:rgba(99,179,237,0.18)] text-[color:var(--color-info)] mx-0.5"
            >
              {m[1]}
            </code>
          );
        }
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}

/**
 * Karakter-karakter typewriter — DASHBOARD_PROMPT "streaming" simülasyonu.
 * Gerçek SSE yok (backend henüz yok); client-side animation.
 *
 * Hız: kısa text için 8ms/char, uzun text için 4ms/char (toplam ~1.5sn cap).
 * `prefers-reduced-motion` set ise anında tam göster.
 */
async function typewriter(
  text: string,
  onUpdate: (partial: string) => void
): Promise<void> {
  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced) {
    onUpdate(text);
    return;
  }
  const targetTotalMs = Math.min(text.length * 8, 1500);
  const interval = Math.max(2, Math.floor(targetTotalMs / Math.max(text.length, 1)));

  // <ref>...</ref> tag'ler tek seferde gelsin (yarı-tag göstermesin)
  const tokens = text.split(/(<ref>.*?<\/ref>)/g).filter(Boolean);
  let acc = "";
  for (const token of tokens) {
    if (token.startsWith("<ref>")) {
      acc += token;
      onUpdate(acc);
      await new Promise((r) => setTimeout(r, interval * 2));
      continue;
    }
    for (const ch of token) {
      acc += ch;
      onUpdate(acc);
      // Karakter atlanan ms — punctuation'da biraz dur
      const wait = ".,!?".includes(ch) ? interval * 6 : interval;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  onUpdate(text);
}

function applyOverlay(
  update: DashboardUpdate,
  setOverlay: (u: DashboardUpdate | null) => void
) {
  setOverlay(update);

  // İlgili bileşene scroll (eğer varsa) — show_metric'e göre id
  const scrollMap: Record<string, string> = {
    category_radar: "section-radar",
    semester_heatmap: "section-2-1",
    coverage_table: "section-2-2",
    bloom_donut: "section-2-3",
    staff_bars: "section-2-5",
    project_heaviness: "section-2-3",
  };
  const target = update.show_metric ? scrollMap[update.show_metric] : null;
  if (target) {
    setTimeout(() => {
      const el = document.getElementById(target);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 200);
  }
}
