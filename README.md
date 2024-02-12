# @openobserve/pino-openobserve

This is a transport for the Pino logging library that sends logs to an Openobserve server in batches. 

## Prerequisites

This package requires Node.js version 18.0.0 or later.

## Installation

You can install this package using npm or Yarn.

With npm:

```bash
npm install @openobserve/pino-openobserve
```

With Yarn:

```bash
yarn add @openobserve/pino-openobserve
```

## Options

The transport accepts an options object with the following properties:

| Property | Required | Default | Description |
| -------- | -------- | ------- | ----------- |
| url | Yes | - | The URL of your Openobserve server. |
| organization | Yes | - | The name of your organization. |
| streamName | Yes | - | The name of the stream to which logs should be sent. |
| auth | Yes | `{ username: "", password: "" }` | An object with `username` and `password` properties for authenticating with the Openobserve server |
| batchSize | No | `100` | The number of logs to include in each batch. |
| timeThreshold | No | `1000` | The interval, in milliseconds, at which logs should be sent. |

## Usage

The way you import the `pino` and `@openobserve/pino-openobserve` packages depends on whether you're using `import` or `require`. 

Using `import`:

```javascript
import pino from 'pino';
import OpenobserveTransport from '@openobserve/pino-openobserve';
```

Using `require`:

```javascript
const pino = require('pino');
const OpenobserveTransport = require('@openobserve/pino-openobserve');
```

After importing the necessary packages, you can use this transport with Pino like this:

```javascript
const logger = pino({
  level: 'info',
  transport: {
    target: OpenobserveTransport,
    options: {
      url: 'https://your-openobserve-server.com',
      organization: 'your-organization',
      streamName: 'your-stream',
      auth: {
        username: 'your-username',
        password: 'your-password',
      },
    },
  },
});

logger.info('Hello, world!');
logger.info({ lang: 'js', code: 'Node.js' }, 'Logging with JSON');
```

In this example, the second `logger.info` call logs a JSON object containing the properties `lang` and `code`, along with the message 'Logging with JSON'. This is a common way to include structured data in your logs when using Pino.

## License

This package is licensed under the Apache License, Version 2.0. See the `LICENSE` file for more details.