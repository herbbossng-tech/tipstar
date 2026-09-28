/**
 * Recent-form model boundary (Section 01 — Football Engine Boundary). No
 * form computation is implemented yet.
 */
export interface FormSummary {
  readonly teamId: string;
  readonly windowSize: number;
  readonly points: number | null;
  readonly asOf: string;
}

export interface FormModel {
  getForm(teamId: string, windowSize: number, asOf: string): Promise<FormSummary | undefined>;
}
