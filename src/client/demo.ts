// Demo organization shown until sign-in and the API are wired to the screens.

export type AgentStatus = "working" | "waiting" | "idle";

export interface DemoAgent {
  id: string;
  role: string;
  name: string;
  status: AgentStatus;
  task: string;
  step: number;
}

export const DEMO_ORG = { name: "freekonomist", goal: "Больше переходов по партнёрским ссылкам" };

export const DEMO_AGENTS: DemoAgent[] = [
  { id: "a1", role: "ceo", name: "CEO", status: "working", task: "Собирает утренний отчёт", step: 1 },
  { id: "a2", role: "techlead", name: "Техлид", status: "working", task: "Проверяет правку заголовков от SEO", step: 2 },
  { id: "a3", role: "qa", name: "Тестировщик", status: "idle", task: "Следующий обход сайта в 09:00", step: 0 },
  { id: "a4", role: "seo", name: "SEO", status: "waiting", task: "Ждёт проверки техлида", step: 3 },
  { id: "a5", role: "content", name: "Контент", status: "working", task: "Обновляет статью про ставку ФРС", step: 2 },
  { id: "a6", role: "analyst", name: "Аналитик", status: "idle", task: "Отчёт готов, следующий в понедельник", step: 3 },
];

export interface DemoApproval {
  id: string;
  from: string;
  title: string;
  why: string;
  before: string;
  after: string;
}

export const DEMO_APPROVALS: DemoApproval[] = [
  {
    id: "p1",
    from: "SEO → Техлид",
    title: "Новые заголовки для 12 страниц рынков",
    why: "Эти страницы показываются в Google, но на них редко нажимают. Более ясный заголовок должен дать больше кликов.",
    before: "Биткоин сегодня",
    after: "Курс биткоина сегодня: что изменилось и почему",
  },
  {
    id: "p2",
    from: "Контент → Техлид",
    title: "Обновлённая статья про ставку ФРС",
    why: "В статье были цифры за прошлый месяц. Обновили по данным ФРС и добавили источник.",
    before: "Цифра ставки за прошлый месяц, без источника",
    after: "Цифра по последнему решению ФРС, со ссылкой на federalreserve.gov",
  },
];

/** The path every change takes before it reaches the live site. */
export const APPROVAL_PIPELINE = [
  { icon: "🤖", title: "Сотрудник", explain: "ИИ-сотрудник готовит правку: текст, код или настройку." },
  { icon: "🛠️", title: "Техлид", explain: "Техлид проверяет правку и запускает автоматические тесты." },
  { icon: "👤", title: "Вы", explain: "Раз в день вы видите все проверенные правки на одной странице и нажимаете «Одобрить»." },
  { icon: "🌐", title: "Сайт", explain: "После вашего «да» правка сама публикуется, а CEO следит за результатом." },
];

export interface DemoKpi {
  label: string;
  value: number;
  suffix?: string;
  delta: number;
  why: string;
  series: number[];
}

export const DEMO_KPIS: DemoKpi[] = [
  { label: "Переходы по партнёрским ссылкам", value: 1284, delta: 18, why: "Рост дали обновлённые страницы рынков: на них стало больше кликов из Google.", series: [62, 70, 66, 81, 90, 88, 104] },
  { label: "Страниц в индексе Google", value: 412, delta: 6, why: "SEO отправил карту сайта, Google добавил 24 новые страницы.", series: [380, 384, 389, 395, 399, 406, 412] },
  { label: "Расход на ИИ за месяц", value: 7.4, suffix: " $", delta: -12, why: "Техлид перевёл рутинные проверки на более дешёвую модель.", series: [1.4, 1.2, 1.1, 1, 0.9, 0.9, 0.9] },
];

export interface DemoMessage {
  author: "owner" | "ceo";
  body: string;
}

export const DEMO_MESSAGES: DemoMessage[] = [
  { author: "ceo", body: "Доброе утро. За вчера переходов по партнёрским ссылкам стало на 18% больше. Две правки ждут вашего одобрения, ссылка во вкладке «Одобрения»." },
  { author: "owner", body: "Что сейчас самое важное?" },
  { author: "ceo", body: "Страницы рынков: они приносят 70% переходов. SEO уже подготовил новые заголовки, техлид их проверяет." },
];
