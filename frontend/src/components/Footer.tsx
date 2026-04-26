/**
 * Footer — sayfanın en altında küçük marka + veri kaynağı uyarısı.
 *
 * Tıklanabilir nav ya da link grubu YOK (kullanıcı isteği). Sadece logo +
 * 1-2 satır küçük italic uyarı: veriler üniversitelerin resmi bölüm
 * sayfalarından alındı, eksiklik olabilir.
 */
export function Footer() {
  return (
    <footer
      className="mt-auto px-4 sm:px-6 lg:px-10 py-6 border-t"
      style={{ borderColor: "var(--color-line)" }}
    >
      <div className="max-w-[1440px] mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="font-serif text-base tracking-tight">
            <span className="font-medium">U</span>niCurriculum
          </span>
          <span className="font-mono text-[10px] uppercase tracking-wider text-[color:var(--color-ink-500)]">
            müfredat karşılaştırma
          </span>
        </div>
        <p className="text-[11px] italic font-serif text-[color:var(--color-ink-500)] leading-snug max-w-2xl sm:text-right">
          Veriler Türk üniversitelerinin resmi bölüm/Bologna sayfalarından
          derlendi. Bazı bilgiler eksik veya güncel olmayabilir; bir
          kategoride veri bulunmaması o üniversitenin o alanda bilgi
          paylaşmadığı anlamına gelir, yokluğu kanıtlamaz.
        </p>
      </div>
    </footer>
  );
}
