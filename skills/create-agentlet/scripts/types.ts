// Types shared by the scripts and by the verification scenarios that the
// skill writes in workspace/<name>/verify.mts.

import type { Download, Page } from 'playwright';

export interface Check {
  name: string;
  ok: boolean;
  detail?: unknown;
}

export interface InjectReport {
  url: string;
  module: string;
  injected: boolean;
  activeModule: string | null;
  panelVisible: boolean;
  checks: Check[];
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
  ok: boolean;
  error?: string;
  registeredModules?: string[] | null;
  screenshot?: string;
}

export type BubbleType = 'success' | 'error' | 'info' | 'warning';

export interface ScenarioHelpers {
  /** Records one check in the report. */
  check(name: string, ok: unknown, detail?: unknown): void;
  /**
   * Waits for a MessageBubble of this type (optionally containing `text`)
   * and returns its message text (without the close glyph and icon). Use it instead of reading the page right after a
   * click: module actions are asynchronous.
   */
  waitForBubble(type?: BubbleType, text?: string, timeout?: number): Promise<string>;
  /** Rows of the first sheet of a downloaded .xlsx, parsed with the SheetJS copy agentlet-core loads. */
  readXlsx(download: Download): Promise<unknown[][]>;
}

/** Default export of workspace/<name>/verify.mts. */
export type Scenario = (page: Page, report: InjectReport, helpers: ScenarioHelpers) => Promise<void>;
