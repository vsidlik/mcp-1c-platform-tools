# 1C: Platform Tools MCP

[![VS Marketplace](https://img.shields.io/visual-studio-marketplace/v/yellow-hammer.mcp-1c-platform-tools?label=VS%20Marketplace&logo=visualstudiocode&color=0098FF)](https://marketplace.visualstudio.com/items?itemName=yellow-hammer.mcp-1c-platform-tools)
[![Open VSX](https://img.shields.io/open-vsx/v/yellow-hammer/mcp-1c-platform-tools?label=Open%20VSX&logo=eclipseide&color=C160EF)](https://open-vsx.org/extension/yellow-hammer/mcp-1c-platform-tools)
[![OpenYellow](https://openyellow.openintegrations.dev/data/badges/1160221881.png)](https://openyellow.org/grid?filter=top&repo=1160221881)
[![telegram chat](resources/badges/telegram-chat.png)](https://t.me/wonder_yellow)
[![Ask Devin](resources/badges/deepwiki-badge.png)](https://deepwiki.com/yellow-hammer/mcp-1c-platform-tools)

MCP-сервер даёт агенту VS Code, Cursor или Claude Code доступ к командам расширения [1C: Platform Tools](https://marketplace.visualstudio.com/items?itemName=yellow-hammer.1c-platform-tools) в проектах конфигуратора, 1С:EDT и OneScript: тесты, профили запуска, сборка конфигурации, работа с базой.

## Установка

1. Установите **1C: Platform Tools**: [Marketplace](https://marketplace.visualstudio.com/items?itemName=yellow-hammer.1c-platform-tools), [Open VSX](https://open-vsx.org/extension/yellow-hammer/1c-platform-tools)
2. Установите **1C: Platform Tools MCP**: [Marketplace](https://marketplace.visualstudio.com/items?itemName=yellow-hammer.mcp-1c-platform-tools), [Open VSX](https://open-vsx.org/extension/yellow-hammer/mcp-1c-platform-tools)
3. Откройте проект 1С (папка с `packagedef`).

## Подключение

Агент работает с тем окном VS Code или Cursor, из которого запущен: каждое окно 1C: Platform Tools открывает свой канал и записывает его в реестр окон, сервер находит окно там. Порт, токен и включение канала настраивать не нужно, окна друг другу не мешают.

**VS Code** больше ничего не требует: расширение регистрирует MCP-сервер само и передаёт ему окно.

**Cursor** не поддерживает провайдер MCP-серверов VS Code, поэтому сервер подключается через `.cursor/mcp.json` проекта. Файл создаёт и обновляет расширение:

1. Палитра команд (F1) → `1C: Platform Tools MCP: Настроить MCP для Cursor`, либо в дереве **Инструменты 1С** → **Навыки для AI** → **Настроить MCP для Cursor**.
2. Перезагрузите окно.
3. Включите сервер `mcp-1c-platform-tools` в настройках MCP: новый сервер Cursor добавляет выключенным.

**Claude Code** берёт сервер из `.mcp.json` проекта, его пишет команда `1C: Platform Tools MCP: Настроить MCP для Claude Code`. Команды выполняет окно VS Code или Cursor с этим проектом: если окна нет, откройте проект (`code <путь>` или `cursor <путь>`).

Команды пишут путь к серверу и папку проекта, по которой сервер находит окно; другие серверы в файле сохраняются. Путь содержит версию расширения, поэтому после обновления запись устаревает и сервер падает с `MODULE_NOT_FOUND`. Расширение чинит это при запуске: обновляет запись, если она ведёт на другую установку этого же расширения. Путь, прописанный вручную (например, на сборку из исходников), остаётся как есть.

## Проверка

Напишите агенту «покажи состояние окружения 1С». В ответе будут активный профиль запуска, версия платформы и путь к базе. Дальше можно просить прогон тестов, переключение профиля, сборку конфигурации.

## Документация

Каталог `docs` публикуется на сайте 1C: Platform Tools разделом [MCP-сервер](https://yellow-hammer.github.io/vscode-1c-platform-tools/mcp/): [установка и подключение](docs/index.md), [параметры инструментов](docs/tool-parameters.md), [что писать агенту](docs/examples.md).

## Настройка вручную

Нужна, только если конфиг заводится без расширения. Сервер находит окно по папке проекта в `MCP_1C_WORKSPACE`:

```json
{
  "mcpServers": {
    "mcp-1c-platform-tools": {
      "command": "node",
      "args": ["<путь к каталогу расширения>/out/src/index.js"],
      "env": {
        "MCP_1C_WORKSPACE": "<папка проекта, открытая в VS Code или Cursor>"
      }
    }
  }
}
```

Каталог расширения: `%USERPROFILE%\.cursor\extensions\yellow-hammer.mcp-1c-platform-tools-<версия>-universal` (Windows) или `~/.cursor/extensions/...` (macOS, Linux). После каждого обновления расширения такой путь придётся править руками.

Без `MCP_1C_WORKSPACE`, например в глобальном конфиге (`%USERPROFILE%\.cursor\mcp.json`), окно выбирается по каталогу, из которого клиент запустил сервер, а вне папок окон — по `projectPath` вызова. Подробнее — в разделе [MCP-сервер](docs/index.md).
