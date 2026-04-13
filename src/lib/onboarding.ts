import fs from "node:fs";
import path from "node:path";

import { DEFAULT_MANAGED_ROOT_ID, EXIT_CODES } from "./constants";
import { CliError } from "./errors";
import { ensureDir, readJsonFile, replaceFileAtomic } from "./fs-utils";
import { rebuildIndex } from "./indexer";
import { loadWorkspaceConfig, resolveRootPath } from "./workspace";

export interface OnboardingSource {
  label: string;
  url: string;
  note: string;
}

export interface OnboardingQuestion {
  id: string;
  prompt: string;
  rationale: string;
  responseType: "text" | "boolean" | "number" | "select" | "multiselect";
  optional: true;
  recommended: boolean;
  options?: string[];
}

export interface OnboardingSection {
  id: string;
  title: string;
  description: string;
  sources: OnboardingSource[];
  questions: OnboardingQuestion[];
}

export interface OnboardingBlueprint {
  profileId: string;
  locale: string;
  title: string;
  description: string;
  sections: OnboardingSection[];
}

export interface CompanyOnboardingAnswersFile {
  profileId?: string;
  answeredAt?: string;
  answeredBy?: string;
  notes?: unknown;
  answers?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface MaterializedOnboardingDocument {
  docId: string;
  title: string;
  absPath: string;
  relPath: string;
  existed: boolean;
  content: string;
}

export interface CompanyOnboardingApplyResult {
  mode: "preview" | "applied";
  profileId: string;
  answeredAt: string;
  answeredBy?: string;
  answerFile: string;
  indexBuildId?: string;
  warnings: string[];
  documents: Array<Omit<MaterializedOnboardingDocument, "content">>;
}

export const COMPANY_ONBOARDING_DE_V1: OnboardingBlueprint = {
  profileId: "de-company-v1",
  locale: "de-DE",
  title: "Unternehmens-Onboarding für das Company Agent Wiki",
  description:
    "Agenten sollen zuerst die rechtlich, steuerlich und organisatorisch wichtigsten Stammdaten klären. Alle Fragen sind überspringbar; empfohlen sind vor allem Rechtsform, Firmierung, Unternehmensgegenstand, Geschäftsführung, Steuer- und Beschäftigungsstatus.",
  sections: [
    {
      id: "legal-identity",
      title: "Rechtlicher Kern",
      description:
        "Dieser Block klärt die offizielle Identität des Unternehmens. Die IHK hebt insbesondere Firmierung, Rechtsform, Rechtsformzusatz, Sitz und Unternehmensgegenstand hervor.",
      sources: [
        {
          label: "IHK Schwaben: Handelsregister und Firmierung",
          url: "https://www.ihk.de/schwaben/produktmarken/recht-und-steuern/handels-und-gesellschaftsrecht/firmenname-554076",
          note:
            "Aktualisiert am 07.01.2026; beschreibt Rechtsformzusatz, Unternehmensgegenstand, Sitz und Handelsregisterbezug."
        },
        {
          label: "Existenzgründungsportal: Rechtsformen",
          url: "https://www.existenzgruendungsportal.de/Navigation/DE/Gruendungswissen/Rechtsformen/rechtsformen",
          note:
            "Dient als Orientierung für Rechtsform, Haftung und steuerliche bzw. organisatorische Folgen."
        }
      ],
      questions: [
        {
          id: "official_legal_name",
          prompt: "Wie lautet die offizielle Firmierung inklusive Rechtsformzusatz?",
          rationale: "Diese Bezeichnung ist für Register, Rechnungen, Impressum und Verträge maßgeblich.",
          responseType: "text",
          optional: true,
          recommended: true
        },
        {
          id: "brand_or_operating_names",
          prompt: "Gibt es zusätzliche Marken-, Produkt- oder operative Namen, unter denen das Unternehmen auftritt?",
          rationale: "Hilft Agenten, öffentliche Namen von der juristischen Firmierung zu unterscheiden.",
          responseType: "multiselect",
          optional: true,
          recommended: false
        },
        {
          id: "legal_form",
          prompt: "Welche Rechtsform hat das Unternehmen?",
          rationale: "Rechtsform beeinflusst Haftung, Registerpflichten, Steuern und Rollenmodell.",
          responseType: "select",
          optional: true,
          recommended: true,
          options: [
            "Einzelunternehmen",
            "GbR",
            "UG (haftungsbeschränkt)",
            "GmbH",
            "GmbH & Co. KG",
            "OHG",
            "KG",
            "AG",
            "eG",
            "Verein",
            "Sonstige",
            "Unklar"
          ]
        },
        {
          id: "registered_seat",
          prompt: "Wo ist der Sitz der Gesellschaft bzw. des Unternehmens?",
          rationale: "Sitz und Unternehmensstandort sind für Register, Zuständigkeiten und Dokumente relevant.",
          responseType: "text",
          optional: true,
          recommended: true
        },
        {
          id: "operating_addresses",
          prompt: "Gibt es weitere Betriebsstätten, Lager, Niederlassungen oder abweichende Geschäftsadressen?",
          rationale: "Wichtig für Agenten, wenn Prozesse orts- oder adressbezogen laufen.",
          responseType: "multiselect",
          optional: true,
          recommended: false
        },
        {
          id: "company_purpose",
          prompt: "Was ist der konkrete Unternehmensgegenstand bzw. die Haupttätigkeit?",
          rationale: "Der Unternehmensgegenstand sollte konkret formuliert sein und hilft bei Routing, Compliance und späterer Connector-Priorisierung.",
          responseType: "text",
          optional: true,
          recommended: true
        },
        {
          id: "incorporation_or_start_date",
          prompt: "Wann wurde das Unternehmen gegründet oder wann wurde die Tätigkeit aufgenommen?",
          rationale: "Wichtig für steuerliche und organisatorische Einordnung.",
          responseType: "text",
          optional: true,
          recommended: true
        },
        {
          id: "register_status",
          prompt: "Ist das Unternehmen im Handelsregister oder in einem anderen Register eingetragen? Falls ja: wo und unter welcher Nummer?",
          rationale: "Registerdaten helfen bei der eindeutigen Identifikation und bei Pflichtangaben.",
          responseType: "text",
          optional: true,
          recommended: true
        }
      ]
    },
    {
      id: "governance-ownership",
      title: "Geschäftsführung, Vertretung und Eigentum",
      description:
        "Dieser Block klärt, wer das Unternehmen führt, wer vertreten darf und welche Eigentümerstruktur für das Wissensmodell relevant ist.",
      sources: [
        {
          label: "Transparenzregister Hilfe",
          url: "https://www.transparenzregister.de/treg/de/hilfe",
          note:
            "Beschreibt insbesondere wirtschaftlich Berechtigte mit mehr als 25 Prozent Kapital- oder Stimmrechtskontrolle."
        },
        {
          label: "IHK Frankfurt: GmbH-Satzung",
          url: "https://www.frankfurt-main.ihk.de/blueprint/servlet/fihk24/recht/mustervertraege/gmbh-satzung-5199308",
          note:
            "Zeigt typische Strukturfelder wie Sitz, Unternehmensgegenstand, Stammkapital und Geschäftsführer."
        }
      ],
      questions: [
        {
          id: "managing_directors",
          prompt: "Wer sind Geschäftsführer, gesetzliche Vertreter oder andere primäre Entscheider?",
          rationale: "Agenten müssen wissen, wer rechtlich und operativ Entscheidungen treffen darf.",
          responseType: "multiselect",
          optional: true,
          recommended: true
        },
        {
          id: "signing_authority",
          prompt: "Gibt es Prokura, Zeichnungsberechtigungen oder andere Vertretungsregelungen?",
          rationale: "Wichtig für Vertrags-, Rechnungs- und Freigabeprozesse.",
          responseType: "text",
          optional: true,
          recommended: false
        },
        {
          id: "shareholders_or_owners",
          prompt: "Sollen Gesellschafter, Anteilseigner oder Eigentümer in der Wissensbasis gepflegt werden?",
          rationale: "Eigentümerbezüge helfen bei Governance, Genehmigungen und Sonderfällen.",
          responseType: "boolean",
          optional: true,
          recommended: true
        },
        {
          id: "beneficial_owners",
          prompt: "Gibt es wirtschaftlich Berechtigte, die mit Namen und Beteiligungspfad erfasst werden sollen?",
          rationale: "Relevant für Transparenzregister, Compliance und Rollenverständnis.",
          responseType: "boolean",
          optional: true,
          recommended: false
        },
        {
          id: "approval_model",
          prompt: "Wer darf fachlich über Buchhaltung, Personal, Verträge und operative Prozesse final entscheiden?",
          rationale: "Das ist keine gesetzliche Pflichtfrage, aber für Agenten im Unternehmen sehr wertvoll.",
          responseType: "text",
          optional: true,
          recommended: true
        }
      ]
    },
    {
      id: "tax-finance",
      title: "Steuern und Finanzbasis",
      description:
        "Dieser Block klärt die steuerliche Erfassung und die umsatzsteuerliche Grundlogik. Die Fragen sind stark von deutschen Behördeninformationen abgeleitet.",
      sources: [
        {
          label: "Bayerisches Landesamt für Steuern: Merkblatt zur steuerlichen Erfassung",
          url: "https://www.finanzamt.bayern.de/Informationen/Steuerinfos/Zielgruppen/Existenzgruender/Merkblattblatt_zur_steuerlichen_Erfassung_Neugruender_Juni_2025.pdf",
          note:
            "Stand Juni 2025; verweist auf den Fragebogen zur steuerlichen Erfassung, ELSTER und die Pflicht zur Mitteilung steuerlich relevanter Verhältnisse."
        },
        {
          label: "BZSt: USt-IdNr beantragen",
          url: "https://www.bzst.de/DE/Unternehmen/Identifikationsnummern/Umsatzsteuer-Identifikationsnummer/FAQ/FAQ_Vergabe/FAQTexte/faq_003.html",
          note:
            "Beschreibt die Beantragung der USt-IdNr, auch direkt im Fragebogen zur steuerlichen Erfassung."
        },
        {
          label: "BZSt: Einführung der Wirtschafts-Identifikationsnummer",
          url: "https://www.bzst.de/SharedDocs/Pressemitteilungen/DE/20241104_einfuhrung_widnr.html",
          note:
            "Pressemitteilung vom 04.11.2024 zur W-IdNr als bundeseinheitliche Wirtschaftsnummer."
        }
      ],
      questions: [
        {
          id: "tax_registration_status",
          prompt: "Ist das Unternehmen steuerlich erfasst und gibt es bereits ein ELSTER-fähiges Setup?",
          rationale: "Grundfrage für spätere steuernahe Prozesse und Agenten-Workflows.",
          responseType: "select",
          optional: true,
          recommended: true,
          options: ["Ja", "Nein", "In Gründung", "Unklar"]
        },
        {
          id: "tax_number",
          prompt: "Sollen Steuernummer und zuständiges Finanzamt in der Wissensbasis gepflegt werden?",
          rationale: "Für Steuerprozesse wichtig, aber sensibel und deshalb bewusst optional.",
          responseType: "boolean",
          optional: true,
          recommended: true
        },
        {
          id: "vat_id",
          prompt: "Gibt es eine USt-IdNr oder muss sie perspektivisch gepflegt werden?",
          rationale: "Relevant bei EU-Binnenmarkt, Reverse-Charge und grenzüberschreitenden Leistungen.",
          responseType: "select",
          optional: true,
          recommended: true,
          options: ["Ja", "Nein", "Beantragt", "Unklar"]
        },
        {
          id: "w_idnr",
          prompt: "Soll die Wirtschafts-Identifikationsnummer mitgeführt werden, wenn sie bereits bekannt ist?",
          rationale: "Hilft bei registerübergreifender Unternehmensidentifikation, ist aber aktuell oft noch im Aufbau.",
          responseType: "select",
          optional: true,
          recommended: false,
          options: ["Ja", "Nein", "Noch nicht bekannt", "Unklar"]
        },
        {
          id: "vat_regime",
          prompt: "Welches Umsatzsteuer-Modell gilt aktuell?",
          rationale: "Für Rechnungs- und Buchungsprozesse zentral.",
          responseType: "select",
          optional: true,
          recommended: true,
          options: ["Regelbesteuerung", "Kleinunternehmerregelung", "Steuerbefreit", "Gemischt", "Unklar"]
        },
        {
          id: "reverse_charge_relevance",
          prompt: "Sind Reverse-Charge- oder EU-Sachverhalte für das Unternehmen regelmäßig relevant?",
          rationale: "Wichtig für Routing in Eingangsrechnungs- und Steuerprozessen.",
          responseType: "select",
          optional: true,
          recommended: true,
          options: ["Ja", "Nein", "Selten", "Unklar"]
        },
        {
          id: "fiscal_year",
          prompt: "Entspricht das Wirtschaftsjahr dem Kalenderjahr oder gibt es ein abweichendes Geschäftsjahr?",
          rationale: "Hilft bei Fristen, Reporting und Dokumentablage.",
          responseType: "text",
          optional: true,
          recommended: true
        },
        {
          id: "tax_advisor",
          prompt: "Gibt es einen Steuerberater oder eine Kanzlei, die in der Wissensbasis als Kontakt hinterlegt werden soll?",
          rationale: "Praktisch wichtig für Eskalation und Zuständigkeiten.",
          responseType: "boolean",
          optional: true,
          recommended: false
        }
      ]
    },
    {
      id: "people-payroll",
      title: "Mitarbeitende und Arbeitgeberstatus",
      description:
        "Dieser Block prüft, ob überhaupt Beschäftigte im Scope sind und welche Stammdaten für Arbeitgeberpflichten relevant werden.",
      sources: [
        {
          label: "Bundesagentur für Arbeit: Betriebsnummern-Service",
          url: "https://www.arbeitsagentur.de/unternehmen/betriebsnummern-service/alles-wichtige",
          note:
            "Erklärt Betriebsnummer, elektronische Beantragung, Änderungsmitteilung und die seit 01.01.2024 erforderliche Unternehmensnummer."
        },
        {
          label: "BMAS: Betriebliche Mitbestimmung",
          url: "https://www.bmas.de/DE/Arbeit/Arbeitsrecht/Arbeitnehmerrechte/Betriebliche-Mitbestimmung/betriebliche-mitbestimmung.html",
          note:
            "Ordnet Schwellenwerte für Betriebsrat und Mitbestimmung ein."
        }
      ],
      questions: [
        {
          id: "employee_count",
          prompt: "Wie viele Mitarbeitende hat das Unternehmen aktuell ungefähr?",
          rationale: "Zentral für Onboarding-Tiefe, Personalprozesse und Mitbestimmungsfragen.",
          responseType: "number",
          optional: true,
          recommended: true
        },
        {
          id: "employee_data_scope",
          prompt: "Sollen Mitarbeitenden-Stammdaten überhaupt in die Wissensbasis aufgenommen werden?",
          rationale: "Die Frage ist bewusst optional, weil Personalwissen sensibel ist.",
          responseType: "boolean",
          optional: true,
          recommended: true
        },
        {
          id: "employment_types",
          prompt: "Welche Beschäftigungsarten gibt es: Vollzeit, Teilzeit, Minijob, freie Mitarbeit, Auszubildende oder anderes?",
          rationale: "Hilft bei Prozessrouting und Personalstruktur.",
          responseType: "multiselect",
          optional: true,
          recommended: false
        },
        {
          id: "payroll_model",
          prompt: "Läuft Lohnabrechnung intern oder über einen externen Dienstleister?",
          rationale: "Agenten brauchen den Verantwortungsweg für Personal- und Payroll-Prozesse.",
          responseType: "select",
          optional: true,
          recommended: false,
          options: ["Intern", "Extern", "Gemischt", "Nicht relevant", "Unklar"]
        },
        {
          id: "betriebsnummer_status",
          prompt: "Gibt es bereits eine Betriebsnummer oder ist sie erst bei Einstellung des ersten Mitarbeiters relevant?",
          rationale: "Für Arbeitgeberpflichten in Deutschland ist das ein zentraler Marker.",
          responseType: "select",
          optional: true,
          recommended: true,
          options: ["Vorhanden", "Noch nicht nötig", "Muss beantragt werden", "Unklar"]
        },
        {
          id: "unternehmensnummer_status",
          prompt: "Ist die Unternehmensnummer des Unfallversicherungsträgers bekannt oder relevant?",
          rationale: "Seit 01.01.2024 wird sie für die Beantragung einer Betriebsnummer benötigt.",
          responseType: "select",
          optional: true,
          recommended: false,
          options: ["Vorhanden", "Nicht vorhanden", "Nicht relevant", "Unklar"]
        }
      ]
    },
    {
      id: "operational-foundation",
      title: "Organisations- und Wissensbasis",
      description:
        "Dieser Block ist eine praxisgeleitete Ableitung für den Agentenbetrieb. Er ist nicht direkt gesetzlich vorgegeben, aber für gute Wissenspflege entscheidend.",
      sources: [
        {
          label: "Abgeleitete Agenten-Praxis",
          url: "https://github.com/codecell-germany",
          note:
            "Diese Fragen sind keine einzelne Behördenvorgabe, sondern aus dem Zielbild des Company Agent Wiki und dem Betriebsmodell abgeleitet."
        }
      ],
      questions: [
        {
          id: "departments_or_domains",
          prompt: "Welche Unternehmensbereiche sollen zuerst modelliert werden, zum Beispiel Buchhaltung, Vertrieb, Personal oder Geschäftsführung?",
          rationale: "Hilft, die erste Wissensstruktur und Priorisierung festzulegen.",
          responseType: "multiselect",
          optional: true,
          recommended: true
        },
        {
          id: "critical_systems",
          prompt: "Welche Systeme sind für den Start besonders wichtig und sollen später als Wissensdomänen oder Connector-Ziele gelten?",
          rationale: "Für den ersten Entwurf reicht eine grobe Liste, selbst wenn Connectoren noch nicht umgesetzt werden.",
          responseType: "multiselect",
          optional: true,
          recommended: true
        },
        {
          id: "initial_roots",
          prompt: "Welche vorhandenen Ordner oder Markdown-Sammlungen sollen zuerst als Wissens-Roots registriert werden?",
          rationale: "Das ist die Brücke vom Unternehmensprofil zur tatsächlichen Wissensbasis.",
          responseType: "multiselect",
          optional: true,
          recommended: true
        },
        {
          id: "confidentiality_needs",
          prompt: "Gibt es Bereiche, die besonders sensibel sind und nur eingeschränkt für Agenten sichtbar sein sollen?",
          rationale: "Wichtig für spätere Rollen- und Trust-Tier-Modelle.",
          responseType: "text",
          optional: true,
          recommended: true
        }
      ]
    }
  ]
};

const COMPANY_ONBOARDING_QUESTION_IDS = new Set(
  COMPANY_ONBOARDING_DE_V1.sections.flatMap((section) => section.questions.map((question) => question.id))
);

const COMPANY_ONBOARDING_METADATA_KEYS = new Set(["profileId", "answeredAt", "answeredBy", "notes", "answers"]);

export function renderOnboardingMarkdown(blueprint: OnboardingBlueprint): string {
  const lines: string[] = [];

  lines.push(`# ${blueprint.title}`);
  lines.push("");
  lines.push(blueprint.description);
  lines.push("");
  lines.push("Alle Fragen sind optional. Auf jede Frage kann auch mit „nein“, „unbekannt“ oder „später“ geantwortet werden.");
  lines.push("");

  for (const section of blueprint.sections) {
    lines.push(`## ${section.title}`);
    lines.push("");
    lines.push(section.description);
    lines.push("");

    for (const question of section.questions) {
      lines.push(`- ${question.prompt}`);
      lines.push(`  Warum: ${question.rationale}`);
      lines.push(`  Empfohlen: ${question.recommended ? "ja" : "nein"}`);
      if (question.options && question.options.length > 0) {
        lines.push(`  Optionen: ${question.options.join(" | ")}`);
      }
    }

    lines.push("");
    lines.push("Quellen:");
    for (const source of section.sources) {
      lines.push(`- ${source.label}: ${source.url}`);
      lines.push(`  Hinweis: ${source.note}`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}

interface NormalizedAnswers {
  profileId: string;
  answeredAt: string;
  answeredBy?: string;
  notes: string[];
  answers: Record<string, unknown>;
}

interface PersonInput {
  name: string;
  role?: string;
  email?: string;
  notes?: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-");
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (typeof entry === "string" || typeof entry === "number") {
          return String(entry).trim();
        }
        if (isRecord(entry) && typeof entry.name === "string") {
          return entry.name.trim();
        }
        return "";
      })
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(/[\n,;]+/u)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return [];
}

function toOptionalString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return undefined;
}

function toOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["ja", "yes", "true", "1"].includes(normalized)) {
      return true;
    }
    if (["nein", "no", "false", "0"].includes(normalized)) {
      return false;
    }
  }
  return undefined;
}

function toOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function toPersonArray(value: unknown, defaultRole: string): PersonInput[] {
  if (Array.isArray(value)) {
    const mapped = value
      .map((entry): PersonInput | null => {
        if (typeof entry === "string") {
          const name = entry.trim();
          return name ? { name, role: defaultRole } : null;
        }
        if (isRecord(entry) && typeof entry.name === "string") {
          return {
            name: entry.name.trim(),
            role: toOptionalString(entry.role) || defaultRole,
            email: toOptionalString(entry.email),
            notes: toStringArray(entry.notes)
          };
        }
        return null;
      });

    return mapped.filter((entry): entry is PersonInput => Boolean(entry && entry.name));
  }

  if (typeof value === "string") {
    return toStringArray(value).map((name) => ({ name, role: defaultRole }));
  }

  if (isRecord(value) && typeof value.name === "string") {
    return [
      {
        name: value.name.trim(),
        role: toOptionalString(value.role) || defaultRole,
        email: toOptionalString(value.email),
        notes: toStringArray(value.notes)
      }
    ];
  }

  return [];
}

function formatValue(value: string | string[] | boolean | number | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "boolean") {
    return value ? "Ja" : "Nein";
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.length > 0 ? value.join(", ") : undefined;
  }
  return value;
}

function renderField(lines: string[], label: string, value: string | string[] | boolean | number | undefined): void {
  const formatted = formatValue(value);
  if (!formatted) {
    return;
  }
  lines.push(`- ${label}: ${formatted}`);
}

function renderSectionBlock(
  title: string,
  fields: Array<[string, string | string[] | boolean | number | undefined]>
): string | undefined {
  const lines: string[] = [];
  for (const [label, value] of fields) {
    renderField(lines, label, value);
  }
  if (lines.length === 0) {
    return undefined;
  }
  return [`## ${title}`, "", ...lines, ""].join("\n");
}

function yamlEscape(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function renderFrontmatter(input: {
  id: string;
  title: string;
  type: string;
  tags: string[];
  answeredAt: string;
  answeredBy?: string;
}): string {
  const lines = [
    "---",
    `id: ${input.id}`,
    `title: ${yamlEscape(input.title)}`,
    `type: ${input.type}`,
    "status: draft",
    "record_state: draft",
    "source: onboarding.de-company-v1",
    `answered_at: ${yamlEscape(input.answeredAt)}`,
    ...(input.answeredBy ? [`answered_by: ${yamlEscape(input.answeredBy)}`] : []),
    "tags:"
  ];

  for (const tag of input.tags) {
    lines.push(`  - ${tag}`);
  }
  lines.push("---", "");
  return lines.join("\n");
}

function normalizeAnswers(payload: CompanyOnboardingAnswersFile, fallbackAnsweredAt: string): NormalizedAnswers {
  const answers = isRecord(payload.answers)
    ? payload.answers
    : Object.fromEntries(
        Object.entries(payload).filter(([key]) => !COMPANY_ONBOARDING_METADATA_KEYS.has(key))
      );

  return {
    profileId: typeof payload.profileId === "string" ? payload.profileId : COMPANY_ONBOARDING_DE_V1.profileId,
    answeredAt: typeof payload.answeredAt === "string" ? payload.answeredAt : fallbackAnsweredAt,
    answeredBy: toOptionalString(payload.answeredBy),
    notes: toStringArray(payload.notes),
    answers
  };
}

function ensureKnownAnswerKeys(payload: CompanyOnboardingAnswersFile): void {
  const topLevelKeys = Object.keys(payload);
  const unknownTopLevel = isRecord(payload.answers)
    ? topLevelKeys.filter((key) => !COMPANY_ONBOARDING_METADATA_KEYS.has(key))
    : topLevelKeys.filter((key) => !COMPANY_ONBOARDING_METADATA_KEYS.has(key) && !COMPANY_ONBOARDING_QUESTION_IDS.has(key));

  if (unknownTopLevel.length > 0) {
    throw new CliError(
      "ONBOARDING_UNKNOWN_TOP_LEVEL_KEYS",
      `Unsupported onboarding top-level keys: ${unknownTopLevel.join(", ")}`,
      EXIT_CODES.validation,
      { hint: "Use supported metadata keys or valid onboarding question IDs only." }
    );
  }

  const answerKeys = isRecord(payload.answers) ? Object.keys(payload.answers) : topLevelKeys.filter((key) => !COMPANY_ONBOARDING_METADATA_KEYS.has(key));
  const unknownAnswerKeys = answerKeys.filter((key) => !COMPANY_ONBOARDING_QUESTION_IDS.has(key));
  if (unknownAnswerKeys.length > 0) {
    throw new CliError(
      "ONBOARDING_UNKNOWN_ANSWER_KEYS",
      `Unsupported onboarding answer keys: ${unknownAnswerKeys.join(", ")}`,
      EXIT_CODES.validation,
      { hint: "Check the onboarding blueprint or question IDs before applying answers." }
    );
  }
}

function isPathInsideWorkspace(workspaceRoot: string, candidatePath: string): boolean {
  const relative = path.relative(path.resolve(workspaceRoot), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveManagedRoot(workspaceRoot: string): string {
  const config = loadWorkspaceConfig(workspaceRoot);
  const managedRoot =
    config.roots.find((root) => root.id === config.managedRootId) ||
    config.roots.find((root) => root.id === DEFAULT_MANAGED_ROOT_ID) ||
    config.roots.find((root) => root.kind === "managed");

  if (!managedRoot) {
    throw new CliError(
      "MANAGED_ROOT_MISSING",
      "No managed Markdown root configured in this workspace.",
      EXIT_CODES.config
    );
  }

  const resolvedPath = resolveRootPath(workspaceRoot, managedRoot);
  if (!isPathInsideWorkspace(workspaceRoot, resolvedPath)) {
    throw new CliError(
      "MANAGED_ROOT_OUTSIDE_WORKSPACE",
      `Managed root must stay inside the private workspace: ${resolvedPath}`,
      EXIT_CODES.config
    );
  }

  return resolvedPath;
}

function createDocument(
  workspaceRoot: string,
  managedRoot: string,
  relPath: string,
  id: string,
  title: string,
  type: string,
  tags: string[],
  body: string,
  answeredAt: string,
  answeredBy?: string
): MaterializedOnboardingDocument {
  const absPath = path.join(managedRoot, relPath);
  return {
    docId: id,
    title,
    absPath,
    relPath: path.relative(workspaceRoot, absPath),
    existed: false,
    content: `${renderFrontmatter({ id, title, type, tags, answeredAt, answeredBy })}${body.trimEnd()}\n`
  };
}

function buildCompanyDocuments(
  workspaceRoot: string,
  normalized: NormalizedAnswers
): { documents: MaterializedOnboardingDocument[]; warnings: string[] } {
  const managedRoot = resolveManagedRoot(workspaceRoot);
  const { answers, answeredAt, answeredBy, notes } = normalized;
  const warnings: string[] = [];
  const documents: MaterializedOnboardingDocument[] = [];

  const legalBlock = renderSectionBlock("Rechtlicher Kern", [
    ["Offizielle Firmierung", toOptionalString(answers.official_legal_name)],
    ["Weitere operative Namen", toStringArray(answers.brand_or_operating_names)],
    ["Rechtsform", toOptionalString(answers.legal_form)],
    ["Sitz", toOptionalString(answers.registered_seat)],
    ["Weitere Standorte", toStringArray(answers.operating_addresses)],
    ["Unternehmensgegenstand", toOptionalString(answers.company_purpose)],
    ["Gründung oder Tätigkeitsaufnahme", toOptionalString(answers.incorporation_or_start_date)],
    ["Registerstatus", toOptionalString(answers.register_status)]
  ]);

  const governanceBlock = renderSectionBlock("Geschäftsführung und Governance", [
    ["Geschäftsführung oder Vertretung", toStringArray(answers.managing_directors)],
    ["Zeichnungs- oder Vertretungsregelungen", toOptionalString(answers.signing_authority)],
    ["Eigentümerpflege in Wissensbasis gewünscht", toOptionalBoolean(answers.shareholders_or_owners)],
    ["Wirtschaftlich Berechtigte separat erfassen", toOptionalBoolean(answers.beneficial_owners)],
    ["Fachliche Finalentscheider", toOptionalString(answers.approval_model)]
  ]);

  const companyBodyBlocks = [legalBlock, governanceBlock].filter(Boolean) as string[];
  if (notes.length > 0) {
    companyBodyBlocks.push(["## Zusätzliche Hinweise", "", ...notes.map((note) => `- ${note}`), ""].join("\n"));
  }

  if (companyBodyBlocks.length > 0) {
    documents.push(
      createDocument(
        workspaceRoot,
        managedRoot,
        "company/company-profile.md",
        "company.profile",
        "Unternehmensprofil",
        "profile",
        ["company", "onboarding", "profile"],
        [
          "# Unternehmensprofil",
          "",
          "Dieses Dokument wurde aus einem optionalen agentengeführten Onboarding erzeugt und dient als Startpunkt für kanonisches Firmenwissen.",
          "",
          ...companyBodyBlocks
        ].join("\n"),
        answeredAt,
        answeredBy
      )
    );
  }

  const taxBlock = renderSectionBlock("Steuern und Finanzbasis", [
    ["Steuerliche Erfassung", toOptionalString(answers.tax_registration_status)],
    ["Steuernummer pflegen", toOptionalBoolean(answers.tax_number)],
    ["USt-IdNr Status", toOptionalString(answers.vat_id)],
    ["W-IdNr Status", toOptionalString(answers.w_idnr)],
    ["Umsatzsteuer-Modell", toOptionalString(answers.vat_regime)],
    ["Reverse-Charge Relevanz", toOptionalString(answers.reverse_charge_relevance)],
    ["Wirtschaftsjahr", toOptionalString(answers.fiscal_year)],
    ["Steuerberater pflegen", toOptionalBoolean(answers.tax_advisor)]
  ]);

  if (taxBlock) {
    documents.push(
      createDocument(
        workspaceRoot,
        managedRoot,
        "company/tax-profile.md",
        "company.tax-profile",
        "Steuerprofil",
        "profile",
        ["company", "tax", "onboarding"],
        [
          "# Steuerprofil",
          "",
          "Zusammenfassung der steuerlichen Grundparameter aus dem optionalen Firmen-Onboarding.",
          "",
          taxBlock
        ].join("\n"),
        answeredAt,
        answeredBy
      )
    );
  }

  const workforceBlock = renderSectionBlock("Mitarbeitende und Arbeitgeberstatus", [
    ["Mitarbeitende gesamt", toOptionalNumber(answers.employee_count)],
    ["Mitarbeitenden-Stammdaten in Wissensbasis", toOptionalBoolean(answers.employee_data_scope)],
    ["Beschäftigungsarten", toStringArray(answers.employment_types)],
    ["Payroll-Modell", toOptionalString(answers.payroll_model)],
    ["Betriebsnummer-Status", toOptionalString(answers.betriebsnummer_status)],
    ["Unternehmensnummer-Status", toOptionalString(answers.unternehmensnummer_status)]
  ]);

  if (workforceBlock) {
    documents.push(
      createDocument(
        workspaceRoot,
        managedRoot,
        "company/workforce-profile.md",
        "company.workforce-profile",
        "Mitarbeitenden- und Arbeitgeberprofil",
        "profile",
        ["company", "people", "onboarding"],
        [
          "# Mitarbeitenden- und Arbeitgeberprofil",
          "",
          "Zusammenfassung der Personal- und Arbeitgebergrundlagen aus dem optionalen Firmen-Onboarding.",
          "",
          workforceBlock
        ].join("\n"),
        answeredAt,
        answeredBy
      )
    );
  }

  const knowledgeScopeBlock = renderSectionBlock("Wissensbasis und Scope", [
    ["Start-Domänen", toStringArray(answers.departments_or_domains)],
    ["Kritische Systeme", toStringArray(answers.critical_systems)],
    ["Erste Wissens-Roots", toStringArray(answers.initial_roots)],
    ["Vertraulichkeitsbedarf", toOptionalString(answers.confidentiality_needs)]
  ]);

  if (knowledgeScopeBlock) {
    documents.push(
      createDocument(
        workspaceRoot,
        managedRoot,
        "company/knowledge-scope.md",
        "company.knowledge-scope",
        "Wissens- und Systemscope",
        "profile",
        ["company", "knowledge", "onboarding"],
        [
          "# Wissens- und Systemscope",
          "",
          "Arbeitsgrundlage für die erste Modellierung des Company Agent Wiki.",
          "",
          knowledgeScopeBlock
        ].join("\n"),
        answeredAt,
        answeredBy
      )
    );
  }

  const executives = toPersonArray(answers.managing_directors, "Geschäftsführung");
  if (toStringArray(answers.managing_directors).length > 0 && executives.length === 0) {
    warnings.push("Geschäftsführungsangaben konnten nicht in Personenprofile überführt werden.");
  }

  const seenPersonSlugs = new Set<string>();
  for (const person of executives) {
    const personSlug = slugify(person.name);
    if (!personSlug) {
      throw new CliError(
        "ONBOARDING_PERSON_SLUG_INVALID",
        `Could not derive a valid person slug from '${person.name}'.`,
        EXIT_CODES.validation,
        { hint: "Use a clearer person name with letters or numbers." }
      );
    }
    if (seenPersonSlugs.has(personSlug)) {
      throw new CliError(
        "ONBOARDING_PERSON_SLUG_CONFLICT",
        `Multiple people resolve to the same slug '${personSlug}'.`,
        EXIT_CODES.validation,
        { hint: "Rename or disambiguate the person entries before applying the onboarding output." }
      );
    }
    seenPersonSlugs.add(personSlug);
    documents.push(
      createDocument(
        workspaceRoot,
        managedRoot,
        `people/${personSlug}.md`,
        `person.${personSlug}`,
        person.name,
        "person",
        ["person", "executive", "onboarding"],
        [
          `# ${person.name}`,
          "",
          "Dieses Personenprofil wurde aus dem optionalen Firmen-Onboarding erzeugt.",
          "",
          renderSectionBlock("Rolle im Unternehmen", [
            ["Name", person.name],
            ["Rolle", person.role],
            ["E-Mail", person.email],
            ["Zusätzliche Hinweise", person.notes]
          ]) || ""
        ].join("\n"),
        answeredAt,
        answeredBy
      )
    );
  }

  return { documents, warnings };
}

export function loadCompanyOnboardingAnswers(answerFile: string): NormalizedAnswers {
  const payload = readJsonFile<CompanyOnboardingAnswersFile>(answerFile);
  ensureKnownAnswerKeys(payload);
  const stats = fs.statSync(answerFile);
  const normalized = normalizeAnswers(payload, stats.mtime.toISOString());
  if (normalized.profileId !== COMPANY_ONBOARDING_DE_V1.profileId) {
    throw new CliError(
      "ONBOARDING_PROFILE_MISMATCH",
      `Unsupported onboarding profile '${normalized.profileId}'.`,
      EXIT_CODES.validation,
      { hint: `Expected profileId '${COMPANY_ONBOARDING_DE_V1.profileId}'.` }
    );
  }
  return normalized;
}

export function previewCompanyOnboarding(
  workspaceRoot: string,
  answerFile: string
): { documents: MaterializedOnboardingDocument[]; warnings: string[]; normalized: NormalizedAnswers } {
  const normalized = loadCompanyOnboardingAnswers(answerFile);
  const materialized = buildCompanyDocuments(workspaceRoot, normalized);

  if (materialized.documents.length === 0) {
    throw new CliError(
      "ONBOARDING_EMPTY",
      "No materializable onboarding answers found in the provided file.",
      EXIT_CODES.validation,
      { hint: "Add at least one answered field before applying the onboarding output." }
    );
  }

  for (const document of materialized.documents) {
    document.existed = fs.existsSync(document.absPath);
  }

  return {
    documents: materialized.documents,
    warnings: materialized.warnings,
    normalized
  };
}

export function applyCompanyOnboarding(options: {
  workspaceRoot: string;
  answerFile: string;
  execute: boolean;
  force?: boolean;
}): CompanyOnboardingApplyResult {
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const answerFile = path.resolve(options.answerFile);
  const preview = previewCompanyOnboarding(workspaceRoot, answerFile);
  const warnings = [...preview.warnings];
  let indexBuildId: string | undefined;

  if (options.execute) {
    const seenPaths = new Set<string>();
    for (const document of preview.documents) {
      if (seenPaths.has(document.absPath)) {
        throw new CliError(
          "ONBOARDING_TARGET_CONFLICT",
          `Multiple onboarding documents resolve to the same target path: ${document.relPath}`,
          EXIT_CODES.validation
        );
      }
      seenPaths.add(document.absPath);

      if (document.existed && !options.force) {
        throw new CliError(
          "ONBOARDING_TARGET_EXISTS",
          `Target file already exists: ${document.relPath}`,
          EXIT_CODES.validation,
          { hint: "Use --force to overwrite generated onboarding files." }
        );
      }
    }

    for (const document of preview.documents) {
      ensureDir(path.dirname(document.absPath));
      if (document.existed) {
        warnings.push(`Overwriting existing file: ${document.relPath}`);
      }
      replaceFileAtomic(document.absPath, document.content);
    }

    const manifest = rebuildIndex(workspaceRoot);
    indexBuildId = manifest.buildId;
  }

  return {
    mode: options.execute ? "applied" : "preview",
    profileId: preview.normalized.profileId,
    answeredAt: preview.normalized.answeredAt,
    answeredBy: preview.normalized.answeredBy,
    answerFile,
    indexBuildId,
    warnings,
    documents: preview.documents.map((document) => ({
      docId: document.docId,
      title: document.title,
      absPath: document.absPath,
      relPath: document.relPath,
      existed: document.existed
    }))
  };
}
