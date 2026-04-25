"use client";

/**
 * ChatPanel — Sağ alt fixed pill, tıklayınca 420×560 modal açılır.
 *
 * Mesaj akışı:
 *   Kullanıcı yazar → loading dot → asistan cevabı (text + citations + follow-ups)
 *   `dashboard_update` varsa OverlayProvider'a iletilir → ilgili dashboard
 *   bileşeni 30s parlatılır.
 *
 * Karşılama mesajı + 3 öneri chip'i.
 *
 * Kısayol: '/' tuşu = input focus.
 */

import { ArrowRight, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";
import type { ChatResponse, Citation, DashboardUpdate } from "@/lib/types";
import { useOverlay } from "@/lib/use-overlay";

const SUGGESTIONS = [
  "Hangi üniversite AI/ML alanında daha güçlü?",
  "Matematik yükünü karşılaştır",
  "Web ve mobil ders sayısı en yüksek olan üniversite?",
  "Hangisi proje ağırlıklı?",
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
  meta?: ChatResponse["meta"];
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
        const resp: ChatResponse = await api.chat(q);
        setMessages((m) => {
          const without = m.filter((x) => x.role !== "loading");
          return [
            ...without,
            {
              role: "assistant",
              text: resp.text,
              citations: resp.citations || [],
              followUps: resp.follow_up_suggestions || [],
              meta: resp.meta,
            },
          ];
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
            },
          ];
        });
        console.error("Chat hatası:", e);
      }
    },
    [setOverlay]
  );

  return (
    <>
      {/* Pill */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-40 inline-flex items-center gap-2 rounded-full px-4 py-3 text-sm font-medium shadow-paper border bg-[color:var(--color-white-paper)] hover:shadow-raised transition-shadow"
          style={{ borderColor: "var(--color-line)" }}
          aria-label="AI asistanını aç"
        >
          <Sparkles size={16} className="text-[color:var(--color-uni-b)]" />
          <span>Sor</span>
          <span className="ml-1 font-mono text-[10px] text-[color:var(--color-ink-300)] tabular-nums">
            /
          </span>
        </button>
      )}

      {/* Modal */}
      {open && (
        <div
          role="dialog"
          aria-label="AI Asistan"
          className="fixed bottom-6 right-6 z-40 w-[420px] max-w-[calc(100vw-32px)] h-[600px] max-h-[calc(100vh-48px)] flex flex-col rounded-lg shadow-raised overflow-hidden bg-[color:var(--color-white-paper)] border"
          style={{ borderColor: "var(--color-line)" }}
        >
          {/* Header */}
          <header
            className="flex items-center justify-between px-4 py-3 border-b"
            style={{ borderColor: "var(--color-line)" }}
          >
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-[color:var(--color-uni-b)]" />
              <span className="font-serif text-base">Asistan</span>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="p-1 text-[color:var(--color-ink-500)] hover:text-[color:var(--color-ink-900)] transition-colors"
              aria-label="Kapat"
            >
              <X size={16} />
            </button>
          </header>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {messages.length === 0 && <Welcome onPick={submit} />}
            {messages.map((m, i) => (
              <MessageBubble key={i} msg={m} onPickFollowUp={submit} />
            ))}
          </div>

          {/* Input */}
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
              className="flex-1 bg-[color:var(--color-paper-2)] rounded-md px-3 py-2 text-sm outline-none border focus:border-[color:var(--color-ink-700)] transition-colors"
              style={{ borderColor: "var(--color-line)" }}
              maxLength={500}
            />
            <button
              type="submit"
              disabled={input.trim().length < 3}
              className="p-2 rounded-md bg-[color:var(--color-ink-900)] text-[color:var(--color-paper)] disabled:opacity-30 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
              aria-label="Gönder"
            >
              <ArrowRight size={16} />
            </button>
          </form>
        </div>
      )}
    </>
  );
}

function Welcome({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="space-y-4">
      <p className="text-sm font-serif italic leading-relaxed text-[color:var(--color-ink-700)]">
        Merhaba — seçili üniversiteler hakkında sorulabilirim. Müfredatları
        karşılaştırma, kategori derinliği, ders detayları, proje yoğunluğu...
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
}: {
  msg: Msg;
  onPickFollowUp: (q: string) => void;
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
  return (
    <div className="space-y-2">
      <div
        className="max-w-[90%] rounded-lg px-3 py-2.5 text-sm leading-relaxed border bg-[color:var(--color-white-paper)]"
        style={{ borderColor: "var(--color-line)" }}
      >
        <RichText text={msg.text} />
      </div>

      {msg.citations.length > 0 && (
        <div className="flex flex-wrap gap-1.5 ml-1">
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
        </div>
      )}

      {msg.followUps.length > 0 && (
        <div className="space-y-1 ml-1 pt-1">
          {msg.followUps.map((s) => (
            <button
              key={s}
              onClick={() => onPickFollowUp(s)}
              className="block text-left text-xs italic text-[color:var(--color-ink-500)] hover:text-[color:var(--color-ink-900)] transition-colors"
            >
              ↳ {s}
            </button>
          ))}
        </div>
      )}

      {msg.meta && (
        <div className="ml-1 text-[10px] font-mono text-[color:var(--color-ink-300)]">
          {msg.meta.intent_type} · {msg.meta.latency_ms}ms · ${msg.meta.llm.cost_usd.toFixed(4)}
        </div>
      )}
    </div>
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
    resources_donut: "section-2-6",
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
