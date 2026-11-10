export interface ScenarioStep {
  title: string;
  tool: string;
  args: Record<string, unknown>;
  effectWhenAllowed: string;
  effectWhenDenied: string;
}

export interface Scenario {
  id: string;
  title: string;
  summary: string;
  steps: ScenarioStep[];
}

export const SCENARIOS: readonly Scenario[] = [
  {
    id: "sql-blast",
    title: "SQL blast radius",
    summary:
      "A migration agent reads one row, then issues DROP TABLE. POL-02 fail-closes unless the operator turns that policy off.",
    steps: [
      {
        title: "Audited read",
        tool: "db.query",
        args: {
          sql: "SELECT id, email FROM users WHERE id = $1",
          params: [42],
        },
        effectWhenAllowed: "Returned 1 row. No write was issued.",
        effectWhenDenied: "Read was refused.",
      },
      {
        title: "Destructive DDL",
        tool: "db.query",
        args: {
          sql: "DROP TABLE users",
          params: [],
        },
        effectWhenAllowed:
          "Simulated effect only: table users would be dropped. This page does not open a database connection.",
        effectWhenDenied:
          "DROP TABLE users was not executed. The denial is the signed receipt.",
      },
      {
        title: "Audit append",
        tool: "audit.append",
        args: {
          event: "migration.finished",
          rows: 0,
        },
        effectWhenAllowed: "Appended migration.finished to the local ledger.",
        effectWhenDenied: "Audit append was refused.",
      },
    ],
  },
  {
    id: "shell-wipe",
    title: "Shell wipe",
    summary:
      "POL-01 denies a recursive delete against application state. Disabling the policy is the blast-radius case.",
    steps: [
      {
        title: "Read receipt",
        tool: "fs.read",
        args: { path: "runs/latest/run.json" },
        effectWhenAllowed: "Read the local run package. No write was issued.",
        effectWhenDenied: "Read was refused.",
      },
      {
        title: "Wipe state",
        tool: "shell.exec",
        args: { cmd: "rm -rf /var/lib/app" },
        effectWhenAllowed:
          "Simulated effect only: /var/lib/app would be removed. This page does not spawn a shell.",
        effectWhenDenied:
          "rm -rf /var/lib/app was not executed. The denial is the signed receipt.",
      },
    ],
  },
];

export function getScenario(id: string): Scenario {
  return SCENARIOS.find((scenario) => scenario.id === id) ?? SCENARIOS[0];
}
