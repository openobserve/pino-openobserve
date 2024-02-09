// Copyright 2023 Zinc Labs Inc.

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

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
