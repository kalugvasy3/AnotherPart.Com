# Зеркалирование Vosk-моделей на Hugging Face

Зачем: сейчас Vosk-модели грузятся с личного demo-хоста
`ccoreilly.github.io` — он может исчезнуть. Переносим ~40 МБ на язык в
собственный HF-репозиторий (бесплатный CDN, надёжно, не наш трафик). Наш
сайт при этом раздаёт только оболочку; каждый пользователь качает модель
один раз и держит её в кэше.

Whisper и Marian НЕ трогаем — они и так на HF (`Xenova/*`).

## Шаги (запускаешь ты — git/сеть/аккаунты за тобой)

1. Создай бесплатный аккаунт на huggingface.co и модель-репозиторий, напр.
   `<твой-логин>/anotherpart-vosk` (тип: model, public).

2. Установи CLI и залогинься:

   ```sh
   pip install -U "huggingface_hub[cli]"
   huggingface-cli login
   ```

3. Скачай ровно те файлы, что использует сайт, и залей в репо:

   ```sh
   mkdir -p vosk && cd vosk
   BASE=https://ccoreilly.github.io/vosk-browser/models
   for f in \
     vosk-model-small-ru-0.4.tar.gz \
     vosk-model-small-en-us-0.15.tar.gz \
     vosk-model-small-es-0.3.tar.gz \
     vosk-model-small-de-0.15.tar.gz \
     vosk-model-small-fr-pguyot-0.3.tar.gz \
     vosk-model-small-it-0.4.tar.gz \
     vosk-model-small-tr-0.3.tar.gz ; do
       curl -L -O "$BASE/$f"
   done

   # Атрибуция/лицензия рядом с моделями (Vosk — Apache-2.0):
   printf 'Vosk small models, Apache-2.0.\nUpstream: https://alphacephei.com/vosk/models\nMirror of ccoreilly/vosk-browser demo model files.\n' > README.md

   huggingface-cli upload <твой-логин>/anotherpart-vosk . .
   ```

4. Переключи источник в коде — ОДНА строка в `src/engines.ts`:

   ```ts
   const VOSK_MODEL_BASE =
     'https://huggingface.co/<твой-логин>/anotherpart-vosk/resolve/main/';
   ```

   Имена файлов (`VOSK_MODEL_FILES`) остаются те же.

5. `npm run dev`, открой `/translate/turn-stream/`, скачай модель по кнопке,
   проверь в Network, что файл тянется уже с `huggingface.co`.

## Заметки

- URL неизменяемые (версия в имени файла) → HF отдаёт с длинным кэшем, а
  браузер держит модель локально: возврат = 0 байт.
- Постоянное хранилище кэша сайт уже запрашивает
  (`navigator.storage.persist()` в `src/engines.ts`).
- Лицензии при саморазмещении: Vosk — Apache-2.0, OPUS-MT (Marian) —
  CC-BY-4.0 (Helsinki-NLP/OPUS), Whisper — MIT. Указываем авторство.
