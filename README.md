# Штаб — ИИ-команда для любого бизнеса

Платформа, где владелец подключает свою организацию и нанимает ИИ-сотрудников: CEO, техлида, тестировщика, SEO, контент, аналитика, почту. Владелец говорит только с CEO и раз в день одобряет проверенные правки по одной ссылке. Каждый процесс показан анимацией с объяснением, чтобы было видно, что происходит.

План продукта: https://claude.ai/artifact/XuFH2qJjaXwRYd6DsByLgK

## Состав

| Часть | Где | Что делает |
| --- | --- | --- |
| Веб-приложение (PWA) | `src/client` | Офис, чат с CEO, одобрения, отчёты, найм. Сейчас на демо-данных |
| API | `src/worker` | Cloudflare Worker на Hono. Вход по подписанной cookie, доступ только к своей организации |
| База | `migrations` | Cloudflare D1. У каждой записи есть `org_id` |
| Роли агентов | `src/shared/roles.ts` | Каталог ролей и шаги их процессов для анимации |
| Стандарты | `docs/standards` | UI rulebook и Code Quality Rulebook |

## Команды

```sh
npm install
npm run dev        # веб-приложение на http://localhost:5173
npm test           # тесты API, включая изоляцию организаций
npm run typecheck
npm run build
```

Для локального API: `npm run db:migrate:local`, затем `npx wrangler dev` с `SESSION_SECRET` в `.dev.vars`.

## Выкладка

Cloudflare Pages, проект `ai-team-platform`, подключён к этому репозиторию: каждый мерж в `main` выкладывается на tamania.io.

- Сборка: `npm run build`, папка `dist/client`; API отдают Pages Functions из `functions/api`.
- База: D1 `ai-team-platform`, привязка `DB` в Settings → Bindings. Таблицы и ключ сессий создаются сами при первом запросе.
- Письма (восстановление пароля) уходят через Resend: секрет `RESEND_API_KEY` в Settings → Variables and secrets, домен tamania.io подтверждён в Resend. Отправитель по умолчанию `noreply@tamania.io`, другой можно задать переменной `MAIL_FROM`.
- Если сборка падает на шаге clone repo («Repository not found»), у приложения Cloudflare в GitHub нет доступа к репозиторию: github.com/settings/installations → Cloudflare Workers and Pages → Repository access.
