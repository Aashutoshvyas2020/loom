export class BrowserToolError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'BrowserToolError';
  }
}

export class BrowserNotReadyError extends BrowserToolError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'BrowserNotReadyError';
  }
}

export class BrowserTabNotFoundError extends BrowserToolError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'BrowserTabNotFoundError';
  }
}

export class BrowserExecutableError extends BrowserToolError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'BrowserExecutableError';
  }
}

export class BrowserEvaluationTimeoutError extends BrowserToolError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'BrowserEvaluationTimeoutError';
  }
}

export interface BrowserTab {
  id: string;
  url: string;
  title: string;
}

export interface BrowserStatusResult {
  running: boolean;
  tabs: number;
  version: string | null;
}

export interface BrowserSnapshotResult {
  tabId: string;
  url: string;
  title: string;
  text: string;
  bytes: number;
  truncated: boolean;
}

export interface BrowserScreenshotResult {
  tabId: string;
  url: string;
  data: Buffer;
  mimeType: 'image/png';
  filePath: string;
}

export interface BrowserEvaluationResult {
  tabId: string;
  url: string;
  json: string;
  bytes: number;
}

export interface BrowserBackend {
  status(): Promise<BrowserStatusResult>;
  tabs(): Promise<BrowserTab[]>;
  open(input: { url?: string }): Promise<BrowserTab>;
  navigate(input: { tabId: string; url: string }): Promise<BrowserTab>;
  snapshot(input: { tabId: string; maxBytes: number }): Promise<BrowserSnapshotResult>;
  click(input: { tabId: string; selector: string }): Promise<{ tabId: string; url: string }>;
  type(input: {
    tabId: string;
    selector: string;
    text: string;
    submit: boolean;
  }): Promise<{ tabId: string; url: string }>;
  evaluate(input: {
    tabId: string;
    expression: string;
    maxBytes: number;
  }): Promise<BrowserEvaluationResult>;
  screenshot(input: {
    tabId: string;
    fullPage: boolean;
    maxBytes: number;
  }): Promise<BrowserScreenshotResult>;
  close(input: { tabId: string }): Promise<{ tabId: string }>;
  grantPermissions(input: {
    origin: string;
    permissions: string[];
  }): Promise<{ origin: string; permissions: string[] }>;
  clearPermissions(input: { origin?: string }): Promise<{ origin?: string }>;
  setGeolocation(input: {
    origin: string;
    latitude: number;
    longitude: number;
    accuracy?: number;
  }): Promise<{
    origin: string;
    latitude: number;
    longitude: number;
    accuracy?: number;
  }>;
  shutdown(): Promise<void>;
}
