import { useEffect, useState } from "react";
import { DEMO_APPROVALS, DEMO_ORG } from "./demo";
import { Approvals } from "./screens/Approvals";
import { Chat } from "./screens/Chat";
import { Office } from "./screens/Office";
import { Reports } from "./screens/Reports";
import { Team } from "./screens/Team";

const TABS = [
  { id: "office", icon: "🏢", label: "Офис" },
  { id: "chat", icon: "💬", label: "Чат с CEO" },
  { id: "approvals", icon: "✅", label: "Одобрения" },
  { id: "reports", icon: "📊", label: "Отчёты" },
  { id: "team", icon: "➕", label: "Нанять" },
] as const;

type TabId = (typeof TABS)[number]["id"];

// The tab lives in the URL hash so a reload or return visit keeps the person's place.
function tabFromHash(): TabId {
  const id = window.location.hash.slice(1);
  return TABS.some((t) => t.id === id) ? (id as TabId) : "office";
}

export function App() {
  const [tab, setTab] = useState<TabId>(tabFromHash);
  const [pending, setPending] = useState(DEMO_APPROVALS.length);

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return (
    <div className="shell">
      <nav className="nav" aria-label="Разделы">
        <div className="nav-brand">
          <span className="nav-brand-mark" aria-hidden>◎</span>
          <span>{DEMO_ORG.name}</span>
        </div>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className="nav-item"
            aria-current={tab === t.id ? "page" : undefined}
            onClick={() => { window.location.hash = t.id; }}
          >
            <span className="nav-icon" aria-hidden>{t.icon}</span>
            <span>{t.label}</span>
            {t.id === "approvals" && pending > 0 && <span className="nav-badge" aria-label={`${pending} ждут`}>{pending}</span>}
          </button>
        ))}
      </nav>
      <main className="main">
        {tab === "office" && <Office />}
        {tab === "chat" && <Chat />}
        {/* Kept mounted so decisions survive switching tabs. */}
        <div hidden={tab !== "approvals"}><Approvals onCountChange={setPending} /></div>
        {tab === "reports" && <Reports />}
        {tab === "team" && <Team />}
      </main>
    </div>
  );
}
