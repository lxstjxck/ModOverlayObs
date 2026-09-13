# Moderator Overlay для OBS

Локальный или self-hosted сервис для модераторского оверлея в OBS. Модераторы управляют только прозрачным Browser Source: добавляют текст, картинки, видео и аудио на полотно, а OBS показывает только центральную область `1920x1080`.

Проект не управляет OBS напрямую, не переключает сцены, не использует удаленный рабочий стол и не захватывает экран стримера.

## Запуск локально

```bash
npm install
npm run db:push
npm run dev -- --host
```

Локальные ссылки:

- Панель модератора: `http://localhost:5173/app`
- Настройка OBS: `http://localhost:5173/obs-setup`
- Overlay для OBS: `http://localhost:5173/overlay/<token>`
- API сервер: `http://localhost:4000`

Начальный аккаунт владельца:

- Логин: `owner`
- Пароль: `change-me-now`

Перед публичным запуском обязательно поменяй логин, пароль и `SESSION_SECRET` в `.env`.

## Настройка OBS

1. Открой `http://localhost:5173/obs-setup`.
2. Скопируй Overlay URL.
3. В OBS добавь источник `Browser Source`.
4. Вставь Overlay URL.
5. Поставь Width = `1920`, Height = `1080`.
6. Оставь Custom CSS пустым.
7. Нажми по источнику правой кнопкой: `Transform -> Reset Transform`.
8. Затем: `Transform -> Fit to Screen`.
9. Размести Browser Source выше игры или захвата экрана.

Если стример находится в другом городе, `localhost` не подойдет. Проект нужно развернуть на VPS с доменом и HTTPS, а стримеру дать публичную ссылку вида:

```text
https://your-domain.example/overlay/<token>
```

## Как это работает

1. Модератор открывает `/app`.
2. Загружает медиа или добавляет ссылку на видео/аудио.
3. Медиа появляется в зоне `SPAWN`, слева от OBS-области.
4. Центральная область `OBS 1920x1080` видна в Browser Source.
5. Все, что находится за пределами этой области, видно только модератору.
6. Чтобы вывести медиа в OBS, перетащи его в центральную OBS-область.
7. Видео и аудио не запускаются автоматически при переносе. Используй кнопки Play/Pause/Stop/Restart в панели свойств.

Поддерживаются:

- изображения;
- GIF;
- видеофайлы;
- прямые ссылки на `.mp4` / `.webm`;
- YouTube watch / shorts / embed ссылки;
- аудиофайлы.

## Управление на полотне

- `Delete` / `Backspace` удаляет выбранный элемент.
- Перемещение прилипает к краям OBS-области, центру и другим видимым элементам.
- `Shift` при перемещении временно отключает прилипание.
- Угловой resize по умолчанию сохраняет пропорции.
- `Shift` при resize меняет размер свободно.
- `Alt` при resize включает crop стороны или угла.
- `Ctrl` / `Cmd` меняет размер от центра.

## Production

Минимальный production-запуск:

```bash
npm install
npm run db:push
npm run build
npm start
```

Рекомендуемые `.env` настройки для публичного сервера:

```bash
NODE_ENV=production
DOMAIN=https://your-domain.example
PUBLIC_ORIGIN=https://your-domain.example
ORIGIN_ALLOWLIST=https://your-domain.example
SESSION_SECRET=<random-string-32-plus-chars>
INITIAL_ADMIN_USERNAME=<owner-name>
INITIAL_ADMIN_PASSWORD=<strong-password>
MAX_TOTAL_UPLOAD_SIZE=5368709120
```

Для публичного доступа используй HTTPS. Удобный вариант: VPS + Docker Compose + Caddy/Nginx как reverse proxy.

## Docker

```bash
docker compose up --build
```

Постоянные данные:

- `./database`
- `./uploads`

## Безопасность

- Не давай `/app` стримеру или зрителям, это панель управления.
- Стримеру нужен только `/overlay/<token>`.
- Если overlay token случайно попал в публичный доступ, пересоздай его на странице OBS Setup.
- Не оставляй дефолтный пароль `change-me-now`.
- Не запускай публичный сервер без HTTPS.

## Проверка проекта

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```
