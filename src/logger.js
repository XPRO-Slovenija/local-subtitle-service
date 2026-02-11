const pino = require('pino');

const isPkg = !!process.pkg;
const isProd = process.env.NODE_ENV === 'production';

// In pkg snapshot, thread-stream worker files aren't available, so disable transports there.
const transport = !isPkg && !isProd
  ? {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
      },
    }
  : undefined;

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport,
  serializers: {},
});

module.exports = logger;
