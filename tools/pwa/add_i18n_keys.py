#!/usr/bin/env python3
"""Insert the PWA / campaign-library translation keys into every dictionary.

The i18n test enforces that every shipped language defines every English key,
so new UI strings have to land in all six dictionaries. This script does the
mechanical part so the translations stay in one table.

Re-run after changing the table below:

    python3 tools/pwa/add_i18n_keys.py
"""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
I18N = ROOT / "packages" / "shared" / "i18n"

# key -> {language: text}
MENU_KEYS = {
    "menu.campaigns": {
        "en": "Campaigns",
        "de": "Kampagnen",
        "fr": "Campagnes",
        "es": "Campañas",
        "ja": "戦役",
        "ru": "Кампании",
    },
}

WARROOM_KEYS = {
    "warroom.campaigns": {
        "en": "Campaign Library",
        "de": "Kampagnenbibliothek",
        "fr": "Bibliothèque de campagnes",
        "es": "Biblioteca de campañas",
        "ja": "戦役ライブラリ",
        "ru": "Библиотека кампаний",
    },
    "warroom.campaignsEyebrow": {
        "en": "The Archive",
        "de": "Das Archiv",
        "fr": "Les Archives",
        "es": "El archivo",
        "ja": "記録庫",
        "ru": "Архив",
    },
    "warroom.campaignsLede": {
        "en": "Every campaign you saved on this device — ready to resume, export to a file, or take with you.",
        "de": "Alle auf diesem Gerät gespeicherten Kampagnen — fortsetzen, in eine Datei exportieren oder mitnehmen.",
        "fr": "Toutes les campagnes enregistrées sur cet appareil — à reprendre, à exporter dans un fichier ou à emporter.",
        "es": "Todas las campañas guardadas en este dispositivo: reanudar, exportar a un archivo o llevarlas contigo.",
        "ja": "この端末に保存した戦役一覧。再開、ファイル書き出し、持ち帰りができます。",
        "ru": "Все кампании, сохранённые на этом устройстве: продолжить, экспортировать в файл или взять с собой.",
    },
    "warroom.campaignsCta": {
        "en": "Open the archive →",
        "de": "Archiv öffnen →",
        "fr": "Ouvrir les archives →",
        "es": "Abrir el archivo →",
        "ja": "記録庫を開く →",
        "ru": "Открыть архив →",
    },
}

BLOCK_KEYS = {
    "pwa.offline": {
        "en": "Offline",
        "de": "Offline",
        "fr": "Hors ligne",
        "es": "Sin conexión",
        "ja": "オフライン",
        "ru": "Нет сети",
    },
    "pwa.offlineLede": {
        "en": "No connection. Single-player keeps working; multiplayer waits for the network.",
        "de": "Keine Verbindung. Das Einzelspiel läuft weiter; Mehrspieler wartet auf das Netz.",
        "fr": "Aucune connexion. Le solo continue ; le multijoueur attend le réseau.",
        "es": "Sin conexión. El modo individual sigue; el multijugador espera la red.",
        "ja": "接続がありません。一人プレイは続行し、マルチプレイは接続を待ちます。",
        "ru": "Нет соединения. Одиночная игра продолжается; мультиплеер ждёт сеть.",
    },
    "pwa.reconnecting": {
        "en": "Reconnecting…",
        "de": "Verbindung wird wiederhergestellt…",
        "fr": "Reconnexion…",
        "es": "Reconectando…",
        "ja": "再接続中…",
        "ru": "Переподключение…",
    },
    "pwa.reconnectingLede": {
        "en": "The connection to the game server dropped. The room catches up when it returns.",
        "de": "Die Verbindung zum Spielserver ist abgerissen. Der Raum holt auf, sobald sie zurück ist.",
        "fr": "La connexion au serveur de jeu a été perdue. La partie reprendra à son retour.",
        "es": "Se perdió la conexión con el servidor de juego. La sala se pondrá al día al volver.",
        "ja": "ゲームサーバーとの接続が切れました。復旧後、部屋は同期します。",
        "ru": "Соединение с игровым сервером прервано. Комната восстановится после возврата связи.",
    },
    "pwa.updateAvailable": {
        "en": "A new version is ready",
        "de": "Eine neue Version ist bereit",
        "fr": "Une nouvelle version est prête",
        "es": "Hay una nueva versión lista",
        "ja": "新しいバージョンが準備できました",
        "ru": "Готова новая версия",
    },
    "pwa.updateLede": {
        "en": "Reload to switch to the new build.",
        "de": "Neu laden, um die neue Version zu verwenden.",
        "fr": "Rechargez pour passer à la nouvelle version.",
        "es": "Recarga para cambiar a la nueva versión.",
        "ja": "再読み込みすると新しいビルドに切り替わります。",
        "ru": "Перезагрузите, чтобы перейти на новую сборку.",
    },
    "pwa.updateApply": {
        "en": "Reload",
        "de": "Neu laden",
        "fr": "Recharger",
        "es": "Recargar",
        "ja": "再読み込み",
        "ru": "Перезагрузить",
    },
    "pwa.updateLater": {
        "en": "Later",
        "de": "Später",
        "fr": "Plus tard",
        "es": "Más tarde",
        "ja": "後で",
        "ru": "Позже",
    },
    "campaigns.title": {
        "en": "Campaign Library",
        "de": "Kampagnenbibliothek",
        "fr": "Bibliothèque de campagnes",
        "es": "Biblioteca de campañas",
        "ja": "戦役ライブラリ",
        "ru": "Библиотека кампаний",
    },
    "campaigns.lede": {
        "en": "Campaigns are stored on this device. They stay available with or without a network.",
        "de": "Kampagnen liegen auf diesem Gerät. Sie sind mit und ohne Netz verfügbar.",
        "fr": "Les campagnes sont stockées sur cet appareil. Elles restent disponibles avec ou sans réseau.",
        "es": "Las campañas se guardan en este dispositivo. Están disponibles con o sin red.",
        "ja": "戦役はこの端末に保存されます。ネットワークの有無にかかわらず利用できます。",
        "ru": "Кампании хранятся на этом устройстве. Они доступны и без сети.",
    },
    "campaigns.empty": {
        "en": "No saved campaigns yet.",
        "de": "Noch keine gespeicherten Kampagnen.",
        "fr": "Aucune campagne enregistrée pour le moment.",
        "es": "Todavía no hay campañas guardadas.",
        "ja": "保存された戦役はまだありません。",
        "ru": "Сохранённых кампаний пока нет.",
    },
    "campaigns.loading": {
        "en": "Loading campaigns…",
        "de": "Kampagnen werden geladen…",
        "fr": "Chargement des campagnes…",
        "es": "Cargando campañas…",
        "ja": "戦役を読み込み中…",
        "ru": "Загрузка кампаний…",
    },
    "campaigns.continue": {
        "en": "Continue",
        "de": "Fortsetzen",
        "fr": "Reprendre",
        "es": "Continuar",
        "ja": "再開",
        "ru": "Продолжить",
    },
    "campaigns.export": {
        "en": "Export",
        "de": "Exportieren",
        "fr": "Exporter",
        "es": "Exportar",
        "ja": "書き出し",
        "ru": "Экспорт",
    },
    "campaigns.exported": {
        "en": "Campaign exported to a file.",
        "de": "Kampagne in eine Datei exportiert.",
        "fr": "Campagne exportée dans un fichier.",
        "es": "Campaña exportada a un archivo.",
        "ja": "戦役をファイルに書き出しました。",
        "ru": "Кампания экспортирована в файл.",
    },
    "campaigns.delete": {
        "en": "Delete",
        "de": "Löschen",
        "fr": "Supprimer",
        "es": "Eliminar",
        "ja": "削除",
        "ru": "Удалить",
    },
    "campaigns.deleted": {
        "en": "Campaign deleted.",
        "de": "Kampagne gelöscht.",
        "fr": "Campagne supprimée.",
        "es": "Campaña eliminada.",
        "ja": "戦役を削除しました。",
        "ru": "Кампания удалена.",
    },
    "campaigns.import": {
        "en": "Import from file",
        "de": "Aus Datei importieren",
        "fr": "Importer depuis un fichier",
        "es": "Importar desde un archivo",
        "ja": "ファイルから読み込み",
        "ru": "Импорт из файла",
    },
    "campaigns.imported": {
        "en": "Campaign imported.",
        "de": "Kampagne importiert.",
        "fr": "Campagne importée.",
        "es": "Campaña importada.",
        "ja": "戦役を読み込みました。",
        "ru": "Кампания импортирована.",
    },
    "campaigns.invalidFile": {
        "en": "That file is not a compatible save.",
        "de": "Diese Datei ist keine kompatible Speicherung.",
        "fr": "Ce fichier n’est pas une sauvegarde compatible.",
        "es": "Ese archivo no es una partida compatible.",
        "ja": "そのファイルは互換のあるセーブではありません。",
        "ru": "Этот файл не является совместимым сохранением.",
    },
    "campaigns.missing": {
        "en": "That campaign could not be read.",
        "de": "Diese Kampagne konnte nicht gelesen werden.",
        "fr": "Cette campagne n’a pas pu être lue.",
        "es": "No se pudo leer esa campaña.",
        "ja": "その戦役を読み込めませんでした。",
        "ru": "Не удалось прочитать эту кампанию.",
    },
    "campaigns.saveCurrent": {
        "en": "Save current game",
        "de": "Aktuelles Spiel speichern",
        "fr": "Enregistrer la partie",
        "es": "Guardar la partida actual",
        "ja": "現在のゲームを保存",
        "ru": "Сохранить текущую игру",
    },
    "campaigns.saved": {
        "en": "Campaign saved.",
        "de": "Kampagne gespeichert.",
        "fr": "Campagne enregistrée.",
        "es": "Campaña guardada.",
        "ja": "戦役を保存しました。",
        "ru": "Кампания сохранена.",
    },
    "campaigns.namePlaceholder": {
        "en": "Campaign name (optional)",
        "de": "Kampagnenname (optional)",
        "fr": "Nom de la campagne (facultatif)",
        "es": "Nombre de la campaña (opcional)",
        "ja": "戦役名（任意）",
        "ru": "Название кампании (необязательно)",
    },
    "campaigns.refresh": {
        "en": "Refresh",
        "de": "Aktualisieren",
        "fr": "Actualiser",
        "es": "Actualizar",
        "ja": "更新",
        "ru": "Обновить",
    },
    "campaigns.back": {
        "en": "Back",
        "de": "Zurück",
        "fr": "Retour",
        "es": "Volver",
        "ja": "戻る",
        "ru": "Назад",
    },
    "campaigns.open": {
        "en": "Campaigns",
        "de": "Kampagnen",
        "fr": "Campagnes",
        "es": "Campañas",
        "ja": "戦役",
        "ru": "Кампании",
    },
}

LANGUAGES = ["en", "de", "fr", "es", "ja", "ru"]


def quote(text: str) -> str:
    escaped = text.replace("\\", "\\\\").replace("'", "\\'")
    return f"'{escaped}'"


def render(keys: dict, language: str) -> list[str]:
    lines = []
    for key, values in keys.items():
        lines.append(f"  '{key}': {quote(values[language])},")
    return lines


def insert_after(lines: list[str], anchor: str, new_lines: list[str]) -> list[str]:
    for index, line in enumerate(lines):
        if anchor in line:
            return lines[: index + 1] + new_lines + lines[index + 1 :]
    raise SystemExit(f"anchor not found: {anchor}")


def main() -> None:
    for language in LANGUAGES:
        path = I18N / f"{language}.ts"
        text = path.read_text(encoding="utf-8")
        lines = text.splitlines()

        if "'menu.campaigns'" not in text:
            lines = insert_after(lines, "'menu.quit':", render(MENU_KEYS, language))
        if "'warroom.campaigns'" not in text:
            lines = insert_after(lines, "'warroom.footerHint':", render(WARROOM_KEYS, language))
        if "'campaigns.title'" not in text:
            # The block goes at the end of the dictionary, before its closing brace.
            close = max(
                index for index, line in enumerate(lines) if line.strip() == "};"
            )
            block = ["", "  // ---- PWA / local campaign library ----"] + render(BLOCK_KEYS, language)
            lines = lines[:close] + block + lines[close:]

        path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        print(f"updated {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
