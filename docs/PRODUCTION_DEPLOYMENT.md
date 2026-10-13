# Обновление существующего VPS

## Twitch TTS до запуска production

В production `.env` явно установить `TTS_ENABLED=false` (это также значение по умолчанию, если переменная отсутствует). Проверить имя переменной в фактическом `EnvironmentFile` сервиса, не публикуя содержимое файла. При выключенном флаге сервер не запускает TTS EventSub WebSocket, генерацию речи, очередь и фоновые reconnect-циклы; API создания и изменения наград возвращает 503. Существующие OAuth-токены, настройки и награды сохраняются. Основная авторизация Twitch и OBS продолжают работать.

Если на старом VPS уже создана награда TTS, владелец канала должен вручную отключить её в [Twitch Creator Dashboard](https://dashboard.twitch.tv/) → «Награды для зрителей» → «Баллы канала» → «Управление наградами». Найти пользовательскую награду TTS (например, «TTS на стриме»), выключить её и проверить, что она больше не доступна зрителям. Не удалять награду: это позволит вернуть её позднее. Проверить очередь уже полученных запросов на награду и вручную решить, какие выполнить или отклонить с возвратом баллов. Путь и переключатель описаны в [руководстве Twitch](https://help.twitch.tv/s/article/channel-points-guide?language=ru). Приложение при выключенном TTS не меняет награды и не обрабатывает запросы на озвучивание; сам факт выключения флага не скрывает ранее созданную награду в Twitch.

Адрес: `https://89-253-255-136.sslip.io`; каталог: `/opt/ModOverlayObs`; сервис: `modoverlay.service`. Это инструкция оператору, **не запускать её автоматически**. Команды рассчитаны на Ubuntu, один процесс Node.js и существующую SQLite-базу. Сначала согласовать окно простоя и целевой commit. Все команды выполнять в SSH-сессии на VPS вручную.

Перезагрузка Browser Source работает только при живом Socket.IO-соединении. Полностью зависший OBS Browser Source удалённо этим механизмом не восстановить: источник надо перезагрузить в OBS. Подтверждение доставки команды не является подтверждением перезагрузки; панель ждёт нового подключения и получения состояния до 15 секунд.

## Проверка

```bash
cd /opt/ModOverlayObs
pwd
git status --short --branch
git rev-parse HEAD
node --version && npm --version
command -v sqlite3 && command -v tar && command -v sha256sum
sudo systemctl status modoverlay.service --no-pager
sudo systemctl show modoverlay.service -p WorkingDirectory -p ExecStart -p EnvironmentFiles -p User -p MemoryMax
sudo nginx -t
sudo ls -l /etc/nginx/sites-enabled/
free -h
df -h /opt/ModOverlayObs
du -sh database uploads node_modules 2>/dev/null
ls -ld .env database uploads
find database -maxdepth 1 -type f -printf '%f %s bytes\n'
find uploads -type f | wc -l
awk -F= '/^[A-Z][A-Z0-9_]*=/ {print $1}' .env | sort
```

Проверить вручную `WorkingDirectory`, `EnvironmentFile`, `ExecStart`, пользователя и ограничения памяти сервиса; фактический путь `DATABASE_URL` и `UPLOAD_DIR` в `.env` либо в systemd. В активном nginx site проверить HTTPS, проксирование `/socket.io` с Upgrade и лимит размера загрузки (в примере репозитория `client_max_body_size 120m` и порт 4000). **Не выводить значения секретов в журнал команд или тикет.** Ниже `DB` и `UPLOADS` заданы для стандартных путей репозитория. Если настройки VPS отличаются, сначала исправить переменные на фактические абсолютные пути. Убедиться, что `DB` указывает на существующий файл, а не на новый пустой путь.

```bash
cd /opt/ModOverlayObs
export DB=/opt/ModOverlayObs/database/modoverlay.db
export UPLOADS=/opt/ModOverlayObs/uploads
test -f "$DB" && test -d "$UPLOADS" && test -f .env
sqlite3 "$DB" 'PRAGMA quick_check; PRAGMA foreign_key_check;'
sqlite3 "$DB" "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
sqlite3 "$DB" "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'Streamer_%' ORDER BY name;"
sqlite3 "$DB" 'SELECT twitchBroadcasterId, COUNT(*) FROM Streamer WHERE twitchBroadcasterId IS NOT NULL GROUP BY twitchBroadcasterId HAVING COUNT(*) > 1;' 2>/dev/null || true
```

Если `quick_check` не вернул `ok`, есть строки от `foreign_key_check`, имеются дубликаты Twitch ID, странная схема или грязный Git checkout — остановиться и разобрать причину. Последний запрос применим после появления столбца `twitchBroadcasterId`; отсутствие столбца надо учесть при сравнении схемы. На старой версии VPS скриптов миграции ещё может не быть; они запускаются ниже после перехода на целевой commit.

Зафиксировать `PREVIOUS_COMMIT=$(git rev-parse HEAD)` и `TARGET_COMMIT` как проверенный SHA нового релиза. Проверить свободное место для SQLite backup, архива uploads, временной восстановленной копии, `npm ci` и сборки; при малом диске репетицию выполнить на другом защищённом хосте с тем же кодом и копией данных. Не продолжать при недостатке места или памяти.

## Backup

**ОПАСНО: `systemctl stop` прерывает эфир и запись состояния.** Остановить сервис до согласованного снимка DB и uploads. Команда SQLite `.backup` создаёт консистентный файл без ручного копирования WAL/SHM. Не удалять исходную DB, `-wal` или `-shm`.

```bash
cd /opt/ModOverlayObs
export PREVIOUS_COMMIT=$(git rev-parse HEAD)
export BACKUP_DIR="/opt/ModOverlayObs/backups/release-$(date -u +%Y%m%dT%H%M%SZ)"
umask 077
mkdir -p "$BACKUP_DIR"
printf '%s\n' "$PREVIOUS_COMMIT" > "$BACKUP_DIR/previous-commit.txt"
sudo systemctl stop modoverlay.service
test ! -f "$DB-wal" || ls -l "$DB-wal"
export DB_BACKUP="$BACKUP_DIR/modoverlay.db"
sqlite3 "$DB" ".backup '$DB_BACKUP'"
test -f "$DB_BACKUP"
tar -C /opt/ModOverlayObs -czf "$BACKUP_DIR/uploads.tar.gz" uploads
cp -a .env "$BACKUP_DIR/.env"
sudo systemctl cat modoverlay.service > "$BACKUP_DIR/modoverlay.service.txt"
sudo cp -a /etc/nginx "$BACKUP_DIR/nginx"
sha256sum "$DB_BACKUP" "$BACKUP_DIR/uploads.tar.gz" "$BACKUP_DIR/.env" > "$BACKUP_DIR/SHA256SUMS"
sudo chmod -R go-rwx "$BACKUP_DIR"
```

**ОПАСНО: backup содержит сессии, OAuth-токены и секреты.** Не отправлять его в Git, чат или общедоступный каталог. Для выноса с VPS использовать защищённое хранилище. Не изменять `SESSION_SECRET`: он нужен для старых TTS-токенов. `OAUTH_TOKEN_ENCRYPTION_KEY` должен оставаться тем же для уже подключённых Twitch-аккаунтов. Не перезаписывать production `.env` файлом `.env.example`.

Проверить восстановление в отдельный каталог, сохранив рабочую DB нетронутой:

```bash
cd /opt/ModOverlayObs
export RESTORE_CHECK=$(mktemp -d /tmp/modoverlay-restore.XXXXXX)
cp -a "$DB_BACKUP" "$RESTORE_CHECK/modoverlay.db"
mkdir "$RESTORE_CHECK/uploads"
tar -C "$RESTORE_CHECK" -xzf "$BACKUP_DIR/uploads.tar.gz"
sqlite3 "$RESTORE_CHECK/modoverlay.db" 'PRAGMA quick_check; PRAGMA foreign_key_check;'
sqlite3 "$RESTORE_CHECK/modoverlay.db" "SELECT COUNT(*) FROM Streamer; SELECT COUNT(*) FROM Media; SELECT COUNT(*) FROM Settings;"
test "$(find "$UPLOADS" -type f | wc -l)" -eq "$(find "$RESTORE_CHECK/uploads" -type f | wc -l)"
sha256sum -c "$BACKUP_DIR/SHA256SUMS"
```

Сравнить количество каналов, медиа и настроек в восстановленной DB с рабочей DB. Это проверка восстановления базы и медиа, а не только целостности архива. **ОПАСНО: `rm -rf "$RESTORE_CHECK"` допустим лишь после проверки, что переменная непуста и путь начинается с `/tmp/modoverlay-restore.`; оставьте копию до конца deployment, если позволяет место.**

## Проверка миграций на копии

Три SQL-миграции: `20261012_twitch_oauth_stage1`, `20261012_channel_access_stage2`, `20261012_channel_identity_unique`. Первая могла быть частично внесена прежним `db push` без истории Prisma. Сначала восстановить недостающие объекты первой миграции скриптом, затем **только если она полностью соответствует SQL и отсутствует в `_prisma_migrations`** зарегистрировать её. `scripts/apply-twitch-oauth-migration.mjs` ведёт отдельный журнал `SchemaMigration`; это не запись Prisma.

Получить новый код после backup, пока сервис остановлен. **ОПАСНО: переключение checkout и `npm ci` меняют файлы приложения.** `git status --short` должен быть пустым. Если рабочие изменения есть, сначала разбирать их вручную.

```bash
cd /opt/ModOverlayObs
git fetch origin
export TARGET_COMMIT=<approved-commit-sha>
git show --no-patch --oneline "$TARGET_COMMIT"
git status --short
git switch --detach "$TARGET_COMMIT"
npm ci
node scripts/inspect-sqlite-migrations.mjs "$DB" > "$BACKUP_DIR/production-before.json"
node scripts/inspect-sqlite-migrations.mjs "$RESTORE_CHECK/modoverlay.db" > "$BACKUP_DIR/restored-before.json"
```

```bash
cd /opt/ModOverlayObs
export DATABASE_URL="file:$RESTORE_CHECK/modoverlay.db"
node scripts/reconcile-twitch-oauth-stage1.mjs --database "$RESTORE_CHECK/modoverlay.db"
# ОПАСНО: только на копии; выполнять --apply лишь если dry run показал недостающие объекты.
node scripts/reconcile-twitch-oauth-stage1.mjs --database "$RESTORE_CHECK/modoverlay.db" --apply
node scripts/reconcile-twitch-oauth-stage1.mjs --database "$RESTORE_CHECK/modoverlay.db"
sqlite3 "$RESTORE_CHECK/modoverlay.db" "SELECT name FROM sqlite_master WHERE type='table' AND name='_prisma_migrations';"
sqlite3 "$RESTORE_CHECK/modoverlay.db" "SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations;" 2>/dev/null || true
```

Если первая миграция уже записана как применённая, пропустить `migrate resolve`. Если есть частично применённая **вторая или третья** миграция, либо неизвестная история Prisma, остановиться: `migrate deploy` не должен угадывать состояние. Перед третьей миграцией проверить уникальность ненулевых `twitchBroadcasterId` на копии.

```bash
sqlite3 "$RESTORE_CHECK/modoverlay.db" 'SELECT twitchBroadcasterId, COUNT(*) FROM Streamer WHERE twitchBroadcasterId IS NOT NULL GROUP BY twitchBroadcasterId HAVING COUNT(*) > 1;'
# ОПАСНО: только на копии, только если stage1 полна и отсутствует в истории Prisma.
npx prisma migrate resolve --applied 20261012_twitch_oauth_stage1
# ОПАСНО: изменяет только копию, указанную через DATABASE_URL.
npx prisma migrate deploy
npx prisma migrate status
npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script
sqlite3 "$RESTORE_CHECK/modoverlay.db" 'PRAGMA quick_check; PRAGMA foreign_key_check;'
node scripts/inspect-sqlite-migrations.mjs "$RESTORE_CHECK/modoverlay.db" > "$BACKUP_DIR/rehearsal-after.json"
```

`migrate diff` должен сообщить, что схема совпадает (пустая миграция). Сравнить counts и fingerprints стабильных полей до/после по отчётам; существующие `Streamer.id`, `overlayToken`, `Media`, `Settings`, `PreviewElement`, `LiveInstance` не должны измениться. Если dry run, применение или сверка неуспешны — **не трогать production DB**. Убедиться, что `production-before.json` и `restored-before.json` совпадают по counts и fingerprints.

## Deployment

Ниже **ОПАСНО: команды меняют схему рабочей DB и состояние сервиса**. Выполнять только после успешной репетиции на целевом коде. Не заменять и не удалять `.env`, `database/`, `uploads/` или `backups/`.

```bash
cd /opt/ModOverlayObs
test "$(git rev-parse HEAD)" = "$TARGET_COMMIT"
export DATABASE_URL="file:$DB"
node scripts/reconcile-twitch-oauth-stage1.mjs --database "$DB"
# ОПАСНО: только если dry run выявил недостающие объекты, как на копии.
node scripts/reconcile-twitch-oauth-stage1.mjs --database "$DB" --apply
node scripts/reconcile-twitch-oauth-stage1.mjs --database "$DB"
# ОПАСНО: только если stage1 полна и отсутствует в истории Prisma.
npx prisma migrate resolve --applied 20261012_twitch_oauth_stage1
# ОПАСНО: применяет миграции к рабочей DB; сверить DATABASE_URL перед запуском.
npx prisma migrate deploy
npx prisma migrate status
npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script
node scripts/inspect-sqlite-migrations.mjs "$DB" > "$BACKUP_DIR/production-after.json"
npm run build
sudo nginx -t
# ОПАСНО: возобновляет эфир с новым кодом.
sudo systemctl start modoverlay.service
```

Пропустить условные `--apply` и `migrate resolve`, если они не нужны; не выполнять их механически. При уже применённых всех трёх миграциях `migrate deploy` должен сообщить об отсутствии ожидающих миграций. **Никогда не использовать** `prisma migrate reset`, `prisma db push`, `--force-reset`, `--accept-data-loss` на рабочей DB. Текущие изменения не меняют Prisma schema, сохранённые медиа или объекты; миграции нужны из-за предыдущих коммитов относительно старой версии VPS. Для Twitch OAuth из предыдущих версий нужны `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `TWITCH_OAUTH_REDIRECT_URI`, `OAUTH_TOKEN_ENCRYPTION_KEY`; проверить `PUBLIC_ORIGIN`, `DOMAIN`, `ORIGIN_ALLOWLIST`, `TTS_ENABLED=false` и сохранение прежнего `SESSION_SECRET`. `TTS_PYTHON` не требуется, пока TTS выключен.

## Validation

```bash
cd /opt/ModOverlayObs
sudo systemctl is-active modoverlay.service
sudo journalctl -u modoverlay.service -n 80 --no-pager
curl -fsS -o /dev/null -w '%{http_code}\n' https://89-253-255-136.sslip.io/
curl -fsS -o /dev/null -w '%{http_code}\n' https://89-253-255-136.sslip.io/login
curl -fsS -o /dev/null -w '%{http_code}\n' https://89-253-255-136.sslip.io/socket.io/?EIO=4\&transport=polling
sqlite3 "$DB" 'PRAGMA quick_check; PRAGMA foreign_key_check;'
sha256sum -c "$BACKUP_DIR/SHA256SUMS"
```

Не вставлять OBS URL, cookie, OAuth-коды или токены в `curl`, логи и скриншоты. В браузере вручную проверить: старый канал и прежний OBS URL без повторного создания; отображение прежних медиа и preview/live; новый Twitch-канал, его отдельный OBS URL и изоляцию; вход владельца и модератора; загрузку файла и playback; блок «Скоро появится» вместо настроек TTS. В панели владельца проверить кнопку «Перезагрузить OBS Overlay» при подключённом Browser Source и при его отсутствии. Убедиться, что у модератора кнопки нет и прямой запрос отклоняется сервером. Для реального OBS отдельно проверить звук, видео, seek, mute/loop/volume и восстановление после reconnect. Проверка доступности `/` не доказывает работоспособность Twitch OAuth, SQLite и OBS.

## Rollback

**ОПАСНО: rollback прерывает эфир и заменяет рабочую DB резервной копией.** Если после обновления появились новые данные, они будут потеряны при полном откате; перед заменой сохранить отдельный снимок текущей DB и uploads для разбора. Не откатывать только код на старую версию при новой схеме без проверки совместимости.

```bash
cd /opt/ModOverlayObs
sudo systemctl stop modoverlay.service
sqlite3 "$DB" ".backup '$BACKUP_DIR/before-rollback.db'"
tar -C /opt/ModOverlayObs -czf "$BACKUP_DIR/uploads-before-rollback.tar.gz" uploads
test -f "$DB_BACKUP" && test -f "$BACKUP_DIR/uploads.tar.gz"
export PREVIOUS_COMMIT=$(cat "$BACKUP_DIR/previous-commit.txt")
# ОПАСНО: восстановить DB только после проверки путей и согласия на потерю новых записей.
sqlite3 "$DB" ".restore '$DB_BACKUP'"
# ОПАСНО: восстанавливать uploads лишь если повреждены; сначала сохранить новые файлы.
# tar -C /opt/ModOverlayObs -xzf "$BACKUP_DIR/uploads.tar.gz"
# ОПАСНО: вернуть прежний код и зависимости.
git switch --detach "$PREVIOUS_COMMIT"
npm ci
npm run build
# .env и конфигурацию nginx/systemd восстанавливать из backup только если они менялись.
sudo nginx -t
sudo systemctl start modoverlay.service
sudo systemctl is-active modoverlay.service
sqlite3 "$DB" 'PRAGMA quick_check; PRAGMA foreign_key_check;'
```

Восстановление SQLite выполнять при остановленном сервисе; сохранить оригинал после сбоя отдельно. `.restore` использует SQLite API и учитывает WAL, не смешивая его с резервной базой вручную. Не менять существующие OBS URL, пока не подтверждена необходимость ротации токена.
