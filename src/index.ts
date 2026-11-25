/*
 * Copyright 2024 Zinc Labs Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Transform, TransformCallback } from "stream";
import { StringDecoder } from "string_decoder";
import * as url from "url";

/**
 * Options for the basic auth
 */
interface AuthOptions {
  /**
   * Your OpenObserve username
   */
  username: string;

  /**
   * Your OpenObserve password
   */
  password: string;
}

/**
 * Configuration options for the OpenObserve transport
 */
interface TransportOptions {
  /**
   * The OpenObserve server URL to send the logs to
   */
  url: string;

  /**
   * The organization to send the logs to
   */
  organization: string;

  /**
   * The stream to send the logs to
   */
  streamName: string;

  /**
   * The authentication options for the OpenObserve server
   */
  auth: AuthOptions;

  /**
   * The number of logs to buffer before sending them in a single request to the OpenObserve server
   * @default 100
   */
  batchSize?: number;

  /**
   * The time, in milliseconds, to wait before sending the buffered logs to the OpenObserve server
   * @default 5 minutes
   */
  timeThreshold?: number;

  /**
   * If true, don't log success messages when sending logs to OpenObserve
   * @default false
   */
  silentSuccess?: boolean;

  /**
   * If true, don't log error messages when sending logs to OpenObserve
   * @default false
   */
  silentError?: boolean;
}

/**
 * One stream's entry in the `status` array of an OpenObserve `_multi` response
 */
interface StreamStatus {
  name?: string;
  successful?: number;
  failed?: number;
  error?: string;
}

// pino writes its own `time` right after the level, ahead of any field the app logs as `time`.
// Only an epoch (10 to 19 digits) or RFC 3339 is taken: OpenObserve drops a record it can't place.
const PINO_TIME =
  /^\{"[^"\\]+":(?:\d+|"[^"\\]*"),"time":(\d{10,19}(?:\.\d+)?(?=[,}])|"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})")/;

/**
 * Adds `_timestamp` from pino's `time`, so OpenObserve keeps the time a log was written
 * rather than the time its batch arrived. Any other line is sent unchanged.
 */
function withTimestamp(line: string): string {
  const match = PINO_TIME.exec(line);
  if (!match || line.includes('"_timestamp":')) {
    return line;
  }
  return `{"_timestamp":${match[1]},${line.slice(1)}`;
}

/**
 * The streams in an OpenObserve response that rejected records. OpenObserve answers 200
 * when only some records fail, and reports them here.
 */
function rejectedStreams(result: unknown): StreamStatus[] {
  const status = (result as { status?: unknown } | null)?.status;
  return Array.isArray(status)
    ? status.filter((s: StreamStatus) => (s?.failed ?? 0) > 0)
    : [];
}

export class OpenobserveTransport extends Transform {
  private options: TransportOptions;
  private logs: string[];
  private pending: string;
  private decoder: StringDecoder;
  private timer: NodeJS.Timeout | null;
  private apiCallInProgress: boolean;
  private sending: Promise<void> | null;
  private ending: boolean;
  private apiUrl: string;

  constructor(options: TransportOptions) {
    super({ objectMode: true });

    const defaultOptions: Partial<TransportOptions> = {
      batchSize: 100,
      timeThreshold: 5 * 60 * 1000,
      silentSuccess: false,
      silentError: false,
    };

    this.options = { ...defaultOptions, ...options } as TransportOptions;

    if (
      !this.options.url ||
      !this.options.organization ||
      !this.options.streamName
    ) {
      throw new Error(
        "OpenObserve Pino: Missing required options: url, organization, or streamName"
      );
    }

    this.logs = [];
    this.pending = "";
    this.decoder = new StringDecoder("utf8");
    this.timer = null;
    this.apiCallInProgress = false;
    this.sending = null;
    this.ending = false;

    process.on("beforeExit", () => {
      if (this.logs.length > 0 && !this.apiCallInProgress) {
        this.sendLogs();
      }
    });

    // nothing is ever pushed, but the readable side must end for `close`, which pino awaits at exit
    this.resume();

    this.apiUrl = this.createApiUrl();
  }

  private createApiUrl(): string {
    const { url: baseUrl, organization, streamName } = this.options;
    const parsedUrl = url.parse(baseUrl);
    const path = parsedUrl.pathname
      ? parsedUrl.pathname.endsWith("/")
        ? parsedUrl.pathname.slice(0, -1)
        : parsedUrl.pathname
      : "";
    return `${parsedUrl.protocol}//${parsedUrl.host}${path}/api/${organization}/${streamName}/_multi`;
  }

  _transform(
    chunk: any,
    encoding: BufferEncoding,
    callback: TransformCallback
  ): void {
    const text =
      typeof chunk === "string"
        ? chunk
        : Buffer.isBuffer(chunk)
        ? this.decoder.write(chunk)
        : `${JSON.stringify(chunk)}\n`;
    // pino's worker can end a chunk partway through a line: hold the tail until the rest arrives
    const lines = (this.pending + text).split("\n");
    this.pending = lines.pop()!;
    for (const line of lines) {
      if (line.trim()) this.logs.push(line);
    }
    this.scheduleSendLogs();
    callback();
  }

  _flush(callback: TransformCallback): void {
    this.ending = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const rest = this.pending + this.decoder.end();
    this.pending = "";
    if (rest.trim()) this.logs.push(rest);
    this.drain().then(() => callback(), callback);
  }

  private async drain(): Promise<void> {
    while (this.sending || this.logs.length > 0) {
      await (this.sending ?? this.sendLogs());
    }
  }

  private scheduleSendLogs(): void {
    if (this.ending) return;
    const { batchSize, timeThreshold } = this.options;
    if (this.logs.length >= batchSize! && !this.apiCallInProgress) {
      this.sendLogs();
    } else if (!this.timer && this.logs.length > 0) {
      // later logs must not reset it: re-arming on every log held a steady stream back until batchSize
      this.timer = setTimeout(() => {
        this.timer = null;
        this.sendLogs();
      }, timeThreshold);
    }
  }

  private sendLogs(): Promise<void> {
    if (this.logs.length === 0 || this.apiCallInProgress) {
      return Promise.resolve();
    }

    const bulkLogs =
      this.logs.splice(0, this.options.batchSize!).map(withTimestamp).join("\n") +
      "\n";

    this.apiCallInProgress = true;
    this.sending = this.post(bulkLogs).finally(() => {
      this.apiCallInProgress = false;
      this.sending = null;
      this.scheduleSendLogs();
    });
    return this.sending;
  }

  private async post(bulkLogs: string): Promise<void> {
    const { auth, silentSuccess, silentError } = this.options;
    try {
      const response = await fetch(this.apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(
            `${auth.username}:${auth.password}`
          ).toString("base64")}`,
          "Content-Type": "application/json",
        },
        body: bulkLogs,
      });

      if (!response.ok) {
        if (!silentError)
          console.error(
            "Failed to send logs:",
            response.status,
            response.statusText
          );
        return;
      }

      const result = await response.json();
      const rejected = rejectedStreams(result);
      if (rejected.length > 0) {
        if (!silentError)
          console.error("OpenObserve rejected some logs:", rejected);
      } else if (!silentSuccess) {
        console.log("successful: ", result);
      }
    } catch (error) {
      if (!silentError) console.error("Failed to send logs:", error);
    }
  }
}

export default (opts: TransportOptions) => new OpenobserveTransport(opts);
