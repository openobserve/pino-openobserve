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

import { Transform, TransformCallback } from 'stream';
import * as url from 'url';

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

class OpenobserveTransport extends Transform {
  private options: TransportOptions;
  private logs: string[];
  private timer: NodeJS.Timeout | null;
  private apiCallInProgress: boolean;
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

    if (!this.options.url || !this.options.organization || !this.options.streamName) {
      throw new Error('OpenObserve Pino: Missing required options: url, organization, or streamName');
    }

    this.logs = [];
    this.timer = null;
    this.apiCallInProgress = false;

    process.on('beforeExit', () => {
      if (this.logs.length > 0 && !this.apiCallInProgress) {
        this.sendLogs();
      }
    });

    this.apiUrl = this.createApiUrl();
  }

  private createApiUrl(): string {
    const { url: baseUrl, organization, streamName } = this.options;
    const parsedUrl = url.parse(baseUrl);
    const path = parsedUrl.pathname ? (parsedUrl.pathname.endsWith('/') ? parsedUrl.pathname.slice(0, -1) : parsedUrl.pathname) : '';
    return `${parsedUrl.protocol}//${parsedUrl.host}${path}/api/${organization}/${streamName}/_multi`;
  }

  _transform(log: any, encoding: BufferEncoding, callback: TransformCallback): void {
    this.logs.push(log);
    this.scheduleSendLogs();
    callback();
  }

  private scheduleSendLogs(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }

    const { batchSize, timeThreshold } = this.options;
    if (this.logs.length >= batchSize! && !this.apiCallInProgress) {
      this.sendLogs();
    } else {
      this.timer = setTimeout(() => this.sendLogs(), timeThreshold);
    }
  }

  private async sendLogs(): Promise<void> {
    if (this.logs.length === 0 || this.apiCallInProgress) {
      return;
    }

    const { auth, silentSuccess, silentError } = this.options;
    const bulkLogs = this.logs.splice(0, this.options.batchSize!).join('');

    this.apiCallInProgress = true;

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}`,
          'Content-Type': 'application/json',
        },
        body: bulkLogs,
      });

      if (response.ok) {
        if (!silentSuccess) console.log('successful: ', await response.json());
      } else {
        if (!silentError) console.error('Failed to send logs:', response.status, response.statusText);
      }


    } catch (error) {
      if (!silentError) console.error('Failed to send logs:', error);
    } finally {
      this.apiCallInProgress = false;
      this.scheduleSendLogs();
    }
  }
}

export default OpenobserveTransport;
