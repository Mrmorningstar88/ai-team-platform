import { useEffect, useState } from "react";
import { getMe, logout, type Me, type Org } from "./api";
import { ProjectTabs } from "./components/ProjectTabs";
import { DEMO_APPROVALS } from "./demo";
import { Approvals } from "./screens/Approvals";
import { Auth } from "./screens/Auth";
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

/** A token from a password-reset email link, if the page was opened from one. */
function resetTokenFromHash(): string | undefined {
  const m = /^#reset=([\w-]+)$/.exec(window.location.hash);
  return m?.[1];
}

/** Shows the sign-in screen until the server confirms a session. */
export function App() {
  const [resetToken] = useState(resetTokenFromHash);
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [notice, setNotice] = useState<string>();

  useEffect(() => {
    void getMe().then((r) => {
      if (r.ok) return setMe(r.data);
      if (r.error === "no_database") setNotice("Сервер ещё не подключён к базе данных. Владельцу нужно добавить базу D1 в настройках Cloudflare.");
      setMe(null);
    });
  }, []);

  if (me === undefined) {
    return (
      <div className="auth" aria-busy="true">
        <span className="typing" aria-label="Загрузка"><i /><i /><i /></span>
      </div>
    );
  }
  if (me === null) return <Auth onSignedIn={setMe} notice={notice} resetToken={resetToken} />;
  return (
    <Workspace
      me={me}
      onSignOut={async () => {
        await logout();
        setMe(null);
      }}
    />
  );
}

const ORG_KEY = "current-project";

function savedOrg(orgs: Org[]): string {
  let id: string | null = null;
  try { id = localStorage.getItem(ORG_KEY); } catch { /* storage may be blocked */ }
  return orgs.some((o) => o.id === id) ? id! : orgs[0]?.id ?? "";
}

function Workspace({ me, onSignOut }: { me: Me; onSignOut: () => void }) {
  const [tab, setTab] = useState<TabId>(tabFromHash);
  const [orgs, setOrgs] = useState(me.orgs);
  const [orgId, setOrgId] = useState(() => savedOrg(me.orgs));
  const org = orgs.find((o) => o.id === orgId) ?? orgs[0];

  function selectOrg(id: string) {
    setOrgId(id);
    try { localStorage.setItem(ORG_KEY, id); } catch { /* storage may be blocked */ }
  }
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
          <span>{me.user.name}</span>
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
        <button type="button" className="nav-item nav-signout" onClick={onSignOut}>
          <span className="nav-icon" aria-hidden>↩︎</span>
          <span>Выйти</span>
        </button>
      </nav>
      <main className="main">
        <ProjectTabs
          orgs={orgs}
          current={org?.id ?? ""}
          onSelect={selectOrg}
          onCreated={(o) => { setOrgs((list) => [...list, o]); selectOrg(o.id); }}
        />
        {/* Keyed by tab so each screen animates in when opened. */}
        <div className="page" key={`${tab}-${org?.id}`}>
          {tab === "office" && org && <Office org={org} />}
          {tab === "chat" && <Chat />}
          {tab === "reports" && <Reports />}
          {tab === "team" && <Team />}
        </div>
        {/* Kept mounted so decisions survive switching tabs. */}
        <div className={tab === "approvals" ? "page" : undefined} hidden={tab !== "approvals"}>
          <Approvals onCountChange={setPending} />
        </div>
      </main>
    </div>
  );
}
