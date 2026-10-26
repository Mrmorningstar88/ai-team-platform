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

/** Where each member of the demo office sits, in floor tiles. "owner" and "site" are fixed spots. */
export const DESKS: Record<string, { x: number; y: number }> = {
  a1: { x: 1.5, y: 1.5 },
  a2: { x: 6, y: 1.5 },
  a3: { x: 10.5, y: 1.5 },
  a4: { x: 1.5, y: 6 },
  a5: { x: 6, y: 6 },
  a6: { x: 10.5, y: 6 },
  owner: { x: 12.4, y: 10.6 },
  site: { x: 14.2, y: 4.2 },
};

export interface StoryBeat {
  from: string;
  to: string;
  /** What travels, shown on the envelope's tag. */
  item: string;
  /** What the sender says while it works. */
  says: string;
  /** Plain explanation shown under the office. */
  explain: string;
}

/** One full loop of the office: a change goes from idea to the live site, then results come back. */
export const STORY: StoryBeat[] = [
  { from: "a1", to: "a4", item: "Задача", says: "Улучши заголовки рынков", explain: "CEO видит, что страницы рынков дают 70% переходов, и поручает SEO улучшить их заголовки." },
  { from: "a4", to: "a2", item: "Правка", says: "Готово, проверь", explain: "SEO переписал 12 заголовков и отдаёт правку техлиду. Сам он на сайт ничего не публикует." },
  { from: "a2", to: "a3", item: "Тест", says: "Проверь на сайте", explain: "Техлид прочитал код и просит тестировщика пройти страницы как обычный посетитель." },
  { from: "a3", to: "a2", item: "Всё ок ✓", says: "Ошибок нет", explain: "Тестировщик открыл страницы с телефона и компьютера: всё работает, ошибок нет." },
  { from: "a2", to: "owner", item: "На одобрение", says: "Можно публиковать", explain: "Проверенная правка попадает в вашу ежедневную ссылку. Без вашего «да» сайт не меняется." },
  { from: "owner", to: "site", item: "Одобрено", says: "Да, публикуем", explain: "Вы нажали «Одобрить», и правка сама уходит на сайт." },
  { from: "a6", to: "a1", item: "+18% кликов", says: "Есть результат", explain: "Через день аналитик считает переходы и сообщает CEO, что правка сработала." },
];
