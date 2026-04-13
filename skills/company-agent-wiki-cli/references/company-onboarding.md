# Company Onboarding Questions

Use this when the workspace exists, but the company profile is still incomplete.

## Goal

The agent should gather the most useful company master data first, without forcing the human to answer everything.

The questionnaire is source-backed. The current model draws especially from:

- IHK guidance on firmierung, Rechtsform, Sitz and Unternehmensgegenstand
- Existenzgründungsportal material on legal forms
- BZSt and tax-office information on tax registration, USt-IdNr and W-IdNr
- Bundesagentur für Arbeit information on Betriebsnummer and Unternehmensnummer
- Transparenzregister guidance on wirtschaftlich Berechtigte

Rules:

- every question is optional
- “nein”, “unbekannt” and “später” are valid answers
- ask only the sections that are relevant
- do not pressure the user into sharing sensitive data

## Start Command

```bash
company-agent-wiki-cli onboarding company
```

For structured agent workflows:

```bash
company-agent-wiki-cli onboarding company --json
```

## Preview and Apply

If the agent has already collected answers, store them in a JSON file and preview the generated draft starter Markdown:

```bash
company-agent-wiki-cli onboarding company \
  --workspace /absolute/path \
  --answers-file /absolute/path/to/company-onboarding-answers.json
```

Write the generated files only with an explicit apply step:

```bash
company-agent-wiki-cli onboarding company \
  --workspace /absolute/path \
  --answers-file /absolute/path/to/company-onboarding-answers.json \
  --execute
```

If target files already exist, the CLI refuses the write unless `--force` is added.
`--execute` requires `--answers-file`, and `--force` is only valid together with `--execute`.

## Answer File Shape

```json
{
  "answeredBy": "AI Agent",
  "notes": ["Buchhaltung zuerst priorisieren"],
  "answers": {
    "official_legal_name": "Beispiel GmbH",
    "legal_form": "GmbH",
    "managing_directors": [
      {
        "name": "Max Beispiel",
        "role": "Geschäftsführer",
        "email": "max@example.com"
      }
    ],
    "vat_regime": "Regelbesteuerung"
  }
}
```

Supported shapes:

- nested metadata plus `answers`
- flat top-level question IDs plus optional metadata such as `profileId`, `answeredAt`, `answeredBy` and `notes`

## Section Logic

- Ask `Rechtlicher Kern` first.
- Then ask `Geschäftsführung, Vertretung und Eigentum`.
- Ask `Steuern und Finanzbasis` if accounting, invoicing or tax workflows matter.
- Ask `Mitarbeitende und Arbeitgeberstatus` only if employees are relevant.
- Ask `Organisations- und Wissensbasis` to map the first domains and roots.

## Important Note

The current Phase-1 CLI can materialize only the onboarding-specific draft starter documents. It does not yet run a fully interactive prompt loop and it does not auto-commit the resulting files.
