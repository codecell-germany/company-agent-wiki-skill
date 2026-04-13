# Authoring Workflow

## Ziel

Agenten sollen neues Wissen so anlegen, dass der Retrieval-Pfad sauber bleibt:

1. sprechender Dateiname
2. starkes Front Matter
3. gute Überschriften
4. danach Index aktualisieren

## Dateiname

Der Dateiname soll grob widerspiegeln, was im Dokument steht. Bevorzuge:

- `projekt-alpha-roadmap.md`
- `buchhaltung-aws-eingangsrechnung.md`
- `vertrieb-lead-qualifizierung.md`

Vermeide:

- `notizen-final-neu.md`
- `dokument1.md`
- `misc.md`

## Minimales Front Matter

```yaml
---
id: projects.alpha.roadmap
title: Projekt Alpha Roadmap
type: project
status: draft
tags:
  - projekt
  - alpha
summary: Roadmap und Entscheidungen für Projekt Alpha.
project: alpha
department: entwicklung
owners:
  - nikolas-gottschol
systems:
  - linear
---
```

`id` ist für neues Wissen ausdrücklich empfohlen, auch wenn der Parser technisch noch eine ID aus dem Pfad ableiten kann.

## Empfohlene Felder

- `title`: menschenlesbarer Titel
- `type`: z. B. `project`, `process`, `policy`, `guide`, `note`
- `status`: z. B. `draft`, `active`, `archived`
- `tags`: freie Schlagwörter
- `summary`: kurze 1-Zeilen-Zusammenfassung für Agenten-Routing
- `project`: Projektkennung oder Projektslug
- `department`: Abteilung oder Verantwortungsbereich
- `owners`: verantwortliche Personen oder Teams
- `systems`: beteiligte Systeme oder Tools
- `id`: stark empfohlen für stabile Referenzen und sauberes Routing

## Provenienz Bei Externem Wissen

Wenn Wissen aus Webrecherche, Nutzerangaben, E-Mails oder anderen externen Quellen stammt, dokumentiere die Herkunft explizit.

Empfohlen:

- `summary` im Front Matter für die Kurzbeschreibung
- im Dokument ein Abschnitt `## Quellenstand`
- Prüfdaten oder Prüfdatum
- Quelle oder URL
- Einordnung wie `Primärquelle`, `Sekundärquelle` oder `Nutzerangabe`

Beispiel:

```md
## Quellenstand

- Geprüft am: 2026-04-12
- Quelle: https://example.com/partner
- Einordnung: Sekundärquelle
- Hinweis: Firmenname und Leistungsbeschreibung wurden zusätzlich durch Nutzerangabe bestätigt.
```

## Struktur im Dokument

- Verwende eine klare `#`-Hauptüberschrift.
- Zerlege Inhalte in sinnvolle `##`- und `###`-Abschnitte.
- Trenne Regeln, Ausnahmen, Beispiele und offene Punkte.

## Empfohlener Anlageprozess Für Neue Dokumente

1. Dokument im passenden Managed Root anlegen, meist unter `knowledge/canonical/`.
2. Dateinamen so wählen, dass er `title` und Inhalt grob repräsentiert.
3. Front Matter setzen, idealerweise inklusive `id`.
4. Bei externem Wissen Provenienz ergänzen.
5. Abschnitte schreiben.
6. `company-agent-wiki-cli index rebuild --workspace /absolute/path --json` ausführen.
7. Optional mit `search --auto-rebuild`, `route --auto-rebuild` und `read --metadata --headings --auto-rebuild` prüfen.
8. Wenn das Dokument strukturell wichtig ist, Navigation oder README ergänzen.

## Integrations-Checkliste

- Datei angelegt
- Dateiname sprechend
- Front Matter vollständig
- Provenienz dokumentiert, wenn externes Wissen eingeflossen ist
- Navigation oder Startseite ergänzt, wenn relevant
- Index aktualisiert
- `read --metadata --headings --auto-rebuild` geprüft

## Bestehendes Wissen Erweitern

Wenn bereits ein passendes Dokument existiert:

1. erst Kandidaten mit `route` oder `search` finden
2. mit `read --metadata --headings --auto-rebuild` Struktur prüfen
3. bestehendes Dokument nur dann erweitern, wenn Thema und Typ sauber passen
4. sonst neues Dokument anlegen und den Einstiegspunkt verlinken

## Retrieval-Prozess für Agenten

1. Mit `search` oder `route` Kandidaten finden.
2. Wenn sinnvoll, direkt mit Filtern wie `--type`, `--project`, `--department`, `--tag`, `--owner`, `--system` eingrenzen.
3. Kandidaten mit `read --metadata --headings --auto-rebuild` prüfen.
4. Nur bei ausreichend passender Metadatenlage den Volltext mit `read --auto-rebuild` laden.

Beispiel:

```bash
company-agent-wiki-cli route "Projekt Alpha Budget" --workspace /absolute/path --type project --project alpha --auto-rebuild --json
company-agent-wiki-cli read --workspace /absolute/path --doc-id canonical.projekt-alpha-roadmap --metadata --headings --auto-rebuild --json
company-agent-wiki-cli read --workspace /absolute/path --doc-id canonical.projekt-alpha-roadmap --auto-rebuild
```

## Muster Für Beziehungswissen

Für Partner-, Netzwerk- oder CRM-Wissen ist dieses Muster oft passend:

```yaml
---
id: crm.partner.beispiel-partner
title: Beispiel Partner
type: relationship
status: draft
tags:
  - crm
  - partner
  - netzwerk
summary: Rolle, Status und Relevanz des Partners im CodeCell-Netzwerk.
department: vertrieb
owners:
  - nikolas-gottschol
---
```

Typische Dokumentabschnitte:

- `## Rolle`
- `## Beziehung und Kontext`
- `## Aktueller Stand`
- `## Nächste Schritte`
- `## Quellenstand`

## Parallelität

Wenn mehrere Agenten dasselbe Workspace verwenden, serialisiere `search`, `route`, `read`, `history` und `diff` möglichst pro Workspace. Der SQLite-Index ist rebuildbar, aber Phase 1 ist nicht für aggressiv parallele Leser ausgelegt.
