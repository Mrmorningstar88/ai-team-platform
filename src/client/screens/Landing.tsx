import { useState } from "react";
import { ROLES, type ProcessStep } from "../../shared/roles";
import { LeadSheet } from "../components/LeadSheet";
import { Logo } from "../components/Logo";
import { OfficeScene } from "../components/OfficeScene";
import { ProcessFlow } from "../components/ProcessFlow";

const HOW_IT_WORKS: ProcessStep[] = [
  { icon: "🎯", title: "Вы ставите цель", explain: "Например: больше заявок с сайта. Одно предложение, без технического задания." },
  { icon: "🧭", title: "CEO планирует", explain: "AI-директор разбивает цель на задачи и раздаёт их команде по приоритету." },
  { icon: "🛠️", title: "Команда делает", explain: "SEO, контент и аналитик готовят правки: тексты, заголовки, отчёты." },
  { icon: "🔍", title: "Техлид проверяет", explain: "Каждая правка проходит проверку и тесты, ошибки возвращаются автору." },
  { icon: "👆", title: "Вы одобряете", explain: "Раз в день одна ссылка: всё проверенное, одно касание «Одобрить»." },
  { icon: "📈", title: "Бизнес растёт", explain: "Правки уходят на сайт, аналитик меряет результат, CEO планирует дальше." },
];

const BENEFITS = [
  { icon: "🌙", title: "Работает 24/7", text: "Команда не уходит в отпуск и не болеет. Утром вас ждёт отчёт о сделанном за ночь." },
  { icon: "🛡️", title: "Ничего без вашего «да»", text: "Каждая правка проверена техлидом и публикуется только после вашего одобрения." },
  { icon: "💸", title: "Дешевле одного сотрудника", text: "Шесть ролей по цене подписки. Без найма, налогов и офиса." },
  { icon: "👀", title: "Всё видно", text: "Живой офис показывает, кто чем занят и на каком шаге каждая задача." },
];

interface Plan {
  name: string;
  price: string;
  per: string;
  pitch: string;
  features: string[];
  cta: string;
  featured?: boolean;
  enterprise?: boolean;
}

const PLANS: Plan[] = [
  {
    name: "Базовый",
    price: "$49",
    per: "в месяц",
    pitch: "Для одного сайта или проекта",
    features: ["1 проект", "Команда из 6 AI-сотрудников", "Ежедневный отчёт CEO", "Одобрение правок в одно касание"],
    cta: "Начать с Базового",
  },
  {
    name: "Средний",
    price: "$99",
    per: "в месяц",
    pitch: "Для нескольких проектов и роста",
    features: ["До 5 проектов", "Все роли, включая AI-почту", "Отчёты аналитика каждую неделю", "Приоритетная очередь задач"],
    cta: "Начать со Среднего",
    featured: true,
  },
  {
    name: "Корпоративный",
    price: "По запросу",
    per: "",
    pitch: "Для компаний с продажами и поддержкой",
    features: ["Безлимит проектов", "AI-колл-центр: звонки и ответы клиентам", "AI-отдел продаж: заявки и сделки", "Настройка под ваши процессы"],
    cta: "Запросить предложение",
    enterprise: true,
  },
];

const FAQ = [
  { q: "Нужно ли уметь программировать?", a: "Нет. Вы пишете цель обычными словами и раз в день нажимаете «Одобрить». Всё техническое делает команда." },
  { q: "Может ли команда что-то сломать?", a: "Каждую правку проверяет техлид и автотесты, а на сайт она попадает только после вашего «да»." },
  { q: "Почему регистрация по промокоду?", a: "Мы в раннем доступе и подключаем владельцев постепенно, чтобы каждому хватило внимания. Оставьте заявку, и мы пришлём код." },
  { q: "Как оплатить тариф?", a: "Сейчас ранний доступ. Оплата картой появится в приложении, и мы заранее напишем об этом на почту." },
];

const go = (hash: string) => () => { window.location.hash = hash; };

/** Public landing page for signed-out visitors. */
export function Landing() {
  const [lead, setLead] = useState<"access" | "enterprise" | null>(null);

  return (
    <div className="landing">
      <header className="l-header">
        <Logo size={34} />
        <nav className="row">
          <a className="btn btn-plain" href="#login">Войти</a>
          <a className="btn btn-primary" href="#signup">Получить доступ</a>
        </nav>
      </header>

      <section className="l-hero">
        <span className="pill l-badge">✨ Ранний доступ по промокоду</span>
        <h1>AI-команда, которая растит ваш бизнес, пока вы спите</h1>
        <p className="l-lead muted">
          CEO, техлид, тестировщик, SEO, контент и аналитик работают круглосуточно. Вы говорите только с CEO и раз в день одобряете проверенные правки.
        </p>
        <div className="l-cta row">
          <button type="button" className="btn btn-primary l-big" onClick={go("signup")}>У меня есть промокод</button>
          <button type="button" className="btn btn-secondary l-big" onClick={() => setLead("access")}>Получить промокод</button>
        </div>
      </section>

      <section className="l-section" aria-labelledby="l-office">
        <h2 id="l-office">Живой офис вашей команды</h2>
        <p className="muted">Смотрите, как задача проходит от CEO до сайта: так выглядит ваш офис после регистрации.</p>
        <OfficeScene onPick={() => {}} />
      </section>

      <section className="l-section card" aria-labelledby="l-how">
        <h2 id="l-how">Как это работает</h2>
        <ProcessFlow steps={HOW_IT_WORKS} label="Как работает Tamania" />
      </section>

      <section className="l-section" aria-labelledby="l-team">
        <h2 id="l-team">Кто в команде</h2>
        <div className="grid">
          {ROLES.map((r) => (
            <article key={r.id} className="card stack l-role">
              <div className="row">
                <div className="avatar" aria-hidden>{r.icon}</div>
                <h3>{r.title}</h3>
              </div>
              <p className="small">{r.pitch}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="l-section" aria-labelledby="l-why">
        <h2 id="l-why">Почему Tamania</h2>
        <div className="grid">
          {BENEFITS.map((b) => (
            <article key={b.title} className="card stack">
              <span className="l-icon" aria-hidden>{b.icon}</span>
              <h3>{b.title}</h3>
              <p className="small muted">{b.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="l-section" id="pricing" aria-labelledby="l-pricing">
        <h2 id="l-pricing">Тарифы</h2>
        <div className="l-plans">
          {PLANS.map((p) => (
            <article key={p.name} className={`card stack l-plan ${p.featured ? "featured" : ""}`}>
              {p.featured && <span className="pill l-popular">Популярный</span>}
              <h3>{p.name}</h3>
              <p className="muted small">{p.pitch}</p>
              <p className="l-price">{p.price} <span className="muted small">{p.per}</span></p>
              <ul className="l-features">
                {p.features.map((f) => <li key={f}>{f}</li>)}
              </ul>
              <button
                type="button"
                className={`btn ${p.featured ? "btn-primary" : "btn-secondary"}`}
                onClick={p.enterprise ? () => setLead("enterprise") : go("signup")}
              >
                {p.cta}
              </button>
            </article>
          ))}
        </div>
      </section>

      <section className="l-section" aria-labelledby="l-faq">
        <h2 id="l-faq">Вопросы</h2>
        <div className="stack">
          {FAQ.map((f) => (
            <details key={f.q} className="card l-faq">
              <summary>{f.q}</summary>
              <p className="muted">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="l-section l-final card">
        <h2>Наймите команду сегодня</h2>
        <p className="muted">Первые владельцы получают доступ по промокоду. Нет кода? Оставьте заявку за 20 секунд.</p>
        <div className="l-cta row">
          <button type="button" className="btn btn-primary l-big" onClick={go("signup")}>У меня есть промокод</button>
          <button type="button" className="btn btn-secondary l-big" onClick={() => setLead("access")}>Получить промокод</button>
        </div>
      </section>

      <footer className="l-footer muted small">
        <Logo size={22} />
        <span>© {new Date().getFullYear()} Tamania</span>
      </footer>

      {lead && <LeadSheet kind={lead} onClose={() => setLead(null)} />}
    </div>
  );
}
