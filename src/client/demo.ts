// Example office for the landing page. Inside a project only the owner's real data is shown.

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

/** Shirt colours for people in the office scene, by role. */
export const SHIRT: Record<string, string> = {
  ceo: "#7a5bc0",
  techlead: "#2f6fc4",
  qa: "#1f8a9c",
  seo: "#c07a1f",
  content: "#c0466a",
  analyst: "#2c8a5c",
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
