/**
 * Simple logger for Weixin module.
 */

interface Logger {
  info: (msg: string, ...args: any[]) => void;
  error: (msg: string, ...args: any[]) => void;
  debug: (msg: string, ...args: any[]) => void;
  warn: (msg: string, ...args: any[]) => void;
  withAccount: (accountId: string) => Logger;
}

const prefix = "[weixin]";

const consoleLogger: Logger = {
  info: (msg: string, ...args: any[]) => console.log(`${prefix} ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`${prefix} ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => {
    if (process.env.DEBUG) {
      console.debug(`${prefix} ${msg}`, ...args);
    }
  },
  warn: (msg: string, ...args: any[]) => console.warn(`${prefix} ${msg}`, ...args),
  withAccount: (accountId: string) => ({
    info: (msg: string, ...args: any[]) => console.log(`${prefix} [${accountId}] ${msg}`, ...args),
    error: (msg: string, ...args: any[]) => console.error(`${prefix} [${accountId}] ${msg}`, ...args),
    debug: (msg: string, ...args: any[]) => {
      if (process.env.DEBUG) {
        console.debug(`${prefix} [${accountId}] ${msg}`, ...args);
      }
    },
    warn: (msg: string, ...args: any[]) => console.warn(`${prefix} [${accountId}] ${msg}`, ...args),
    withAccount: (id: string) => consoleLogger.withAccount(`${accountId}:${id}`),
  }),
};

export const logger = consoleLogger;
