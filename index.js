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

const { Transform } = require('stream');
const url = require('url');

class OpenobserveTransport extends Transform {
  constructor(options) {
    super({ objectMode: true });

    const defaultOptions = {
      url: undefined,
      organization: undefined,
      streamName: undefined,
      auth: {
        username: "",
        password: "",
      },
      batchSize: 100,
      timeThreshold: 5 * 60 * 1000,
    };

    this.options = { ...defaultOptions, ...options };

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

  createApiUrl() {
    const { url: baseUrl, organization, streamName } = this.options;
    const parsedUrl = url.parse(baseUrl);
    const path = parsedUrl.pathname.endsWith('/') ? parsedUrl.pathname.slice(0, -1) : parsedUrl.pathname;
    const apiUrl = `${parsedUrl.protocol}//${parsedUrl.host}${path}/api/${organization}/${streamName}/_multi`;
    return apiUrl;
  }

  _transform(log, encoding, callback) {
    this.logs.push(log);
    this.scheduleSendLogs();
    callback();
  }

  scheduleSendLogs() {
    if (this.timer) {
      clearTimeout(this.timer);
    }

    const { batchSize, timeThreshold } = this.options;
    if (this.logs.length >= batchSize && !this.apiCallInProgress) {
      this.sendLogs();
    } else {
      this.timer = setTimeout(() => this.sendLogs(), timeThreshold);
    }
  }

  sendLogs() {
    if (this.logs.length === 0 || this.apiCallInProgress) {
      return;
    }

    const { auth } = this.options;
    const bulkLogs = this.logs.splice(0, this.options.batchSize).join('');

    this.apiCallInProgress = true;

    fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: bulkLogs,
    })
      .then(async response => {
        if (response.ok) {
          console.log('successful: ', await response.json());
        } else {
          console.error('Failed to send logs:', response.status, response.statusText);
        }
      })
      .catch(error => {
        console.error('Failed to send logs:', error);
      })
      .finally(() => {
        this.apiCallInProgress = false;
        this.scheduleSendLogs();
      });
  }
}

module.exports = OpenobserveTransport;
