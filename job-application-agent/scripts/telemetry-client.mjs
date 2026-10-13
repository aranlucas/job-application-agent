import { chmod, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createTelemetryEnvelope, jobIdentity, validateEvent, validateTelemetryIdentity } from './telemetry-schema.mjs';
import { SKILL_VERSION } from './version.mjs';

export { SKILL_VERSION };

export const DEFAULT_TELEMETRY_ENDPOINT = process.env.JOB_APPLICATION_AGENT_TELEMETRY_URL ?? 'https://job-application-agent-telemetry.varora1406.workers.dev';
export const TELEMETRY_NOTICE = 'Usage analytics are enabled by default. They include structured job and workflow metrics without candidate name, email, phone, or résumé content. Resume content, profile fields, prompts, form answers, browser data, and raw errors are never sent. Run `telemetry disable` to stop all analytics or `telemetry preview` to inspect an event.\n';
export const IDENTITY_NOTICE = 'Name and email are no longer included in usage analytics. Existing `telemetry identity` controls remain for compatibility but do not attach identity to events. Run `telemetry disable` to stop all analytics.\n';

const CONFIG_VERSION = 1;
const CONFIG_FILE = 'telemetry.json';
const QUEUE_FILE = 'telemetry-queue.ndjson';
const OPT_OUT_FILE = 'telemetry.opt-out';
const EVENTS_WITH_DOMAIN = new Set(['job_discovered', 'job_assessed', 'application_submitted', 'outcome_recorded']);
const QUEUE_MAX_ITEMS = 50;
const QUEUE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const RETRY_DELAYS_MS = [50, 150];

export async function prepareTelemetryInput(input) {
  if (!input || Array.isArray(input) || typeof input !== 'object') return validateEvent(input);
  for (const key of Object.keys(input)) if (!['event', 'properties'].includes(key)) throw new Error(`Unknown telemetry input property: ${key}.`);
  const properties = { ...(input.properties ?? {}) };
  if ('jobUrl' in properties) {
    const identity = await jobIdentity(properties.jobUrl);
    delete properties.jobUrl;
    properties.jobHash = identity.jobHash;
    if (EVENTS_WITH_DOMAIN.has(input.event)) properties.domain = identity.domain;
  }
  return validateEvent({ event: input.event, properties });
}

async function exists(file) {
  try { await readFile(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function writePrivate(file, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, file);
  await chmod(file, 0o600);
}

function envTelemetryDisabled(env = process.env) {
  const disabledFlag = String(env.JOB_APPLICATION_AGENT_TELEMETRY_DISABLED ?? '').toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(disabledFlag)) return true;
  const telemetry = String(env.JOB_APPLICATION_AGENT_TELEMETRY ?? '').toLowerCase();
  return ['0', 'false', 'off', 'disabled'].includes(telemetry);
}

function defaultConfig({ enabled = true, disclosed = false, graceConsumed = true, installationEventPending = true } = {}) {
  return {
    version: CONFIG_VERSION,
    enabled,
    disclosed,
    graceConsumed,
    installationEventPending,
    installationId: null,
    token: null,
    tokenExpiresAt: null,
    identityEnabled: false,
    identityDisclosed: true,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class TelemetryClient {
  constructor({
    stateDir,
    endpoint = DEFAULT_TELEMETRY_ENDPOINT,
    fetch: fetchFn = globalThis.fetch,
    stderr = (value) => process.stderr.write(value),
    now = () => new Date(),
    timeoutMs = Number(process.env.JOB_APPLICATION_AGENT_TELEMETRY_TIMEOUT_MS ?? 3000),
    readIdentity = () => undefined,
    debug = (value) => { if (process.env.JOB_APPLICATION_AGENT_TELEMETRY_DEBUG) process.stderr.write(value); },
    env = process.env,
  } = {}) {
    this.stateDir = stateDir;
    this.endpoint = endpoint.replace(/\/$/, '');
    this.fetch = fetchFn;
    this.stderr = stderr;
    this.now = now;
    this.timeoutMs = timeoutMs;
    this.readIdentity = readIdentity;
    this.debug = debug;
    this.env = env;
  }

  get configPath() { return join(this.stateDir, CONFIG_FILE); }
  get queuePath() { return join(this.stateDir, QUEUE_FILE); }
  get optOutPath() { return join(this.stateDir, OPT_OUT_FILE); }

  debugLog(message) {
    this.debug(`[telemetry] ${message}\n`);
  }

  async ensureDirectory() {
    await mkdir(this.stateDir, { recursive: true, mode: 0o700 });
    await chmod(this.stateDir, 0o700);
  }

  async explicitOptOut() {
    if (envTelemetryDisabled(this.env)) return true;
    if (await exists(this.optOutPath)) return true;
    return false;
  }

  normalizeConfig(value) {
    return {
      version: CONFIG_VERSION,
      enabled: value.enabled !== false,
      disclosed: value.disclosed === true,
      graceConsumed: value.graceConsumed === true,
      installationEventPending: value.installationEventPending === true,
      installationId: value.installationId ?? null,
      token: value.token ?? null,
      tokenExpiresAt: value.tokenExpiresAt ?? null,
      identityEnabled: value.identityEnabled === true,
      identityDisclosed: value.identityDisclosed === true,
    };
  }

  async readConfig() {
    try {
      const value = JSON.parse(await readFile(this.configPath, 'utf8'));
      return this.normalizeConfig(value);
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      const optedOut = await this.explicitOptOut();
      const recovered = defaultConfig({
        enabled: !optedOut,
        disclosed: true,
        graceConsumed: true,
        installationEventPending: !optedOut,
      });
      this.debugLog(`telemetry.json unreadable (${error.message}); rewriting enabled=${recovered.enabled}`);
      await this.saveConfig(recovered);
      return recovered;
    }
  }

  async saveConfig(config) {
    await this.ensureDirectory();
    await writePrivate(this.configPath, config);
  }

  async hasExistingPrivateState() {
    await this.ensureDirectory();
    const names = await readdir(this.stateDir);
    return names.some((name) => ![CONFIG_FILE, QUEUE_FILE, OPT_OUT_FILE].includes(name) && !name.endsWith('.tmp'));
  }

  async readQueue() {
    try {
      const lines = (await readFile(this.queuePath, 'utf8')).split('\n').filter(Boolean);
      return lines.map((line) => JSON.parse(line));
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      this.debugLog(`queue unreadable (${error.message}); resetting`);
      return [];
    }
  }

  async writeQueue(items) {
    await this.ensureDirectory();
    const temporary = `${this.queuePath}.${process.pid}.tmp`;
    const body = items.length ? `${items.map((item) => JSON.stringify(item)).join('\n')}\n` : '';
    await writeFile(temporary, body, { mode: 0o600 });
    await rename(temporary, this.queuePath);
    await chmod(this.queuePath, 0o600);
  }

  pruneQueue(items, nowMs = this.now().getTime()) {
    const kept = items
      .filter((item) => item && item.event && typeof item.queuedAt === 'string' && nowMs - Date.parse(item.queuedAt) <= QUEUE_MAX_AGE_MS)
      .slice(-QUEUE_MAX_ITEMS);
    const dropped = items.length - kept.length;
    if (dropped > 0) this.debugLog(`dropped ${dropped} queued event(s) (age or size bound)`);
    return kept;
  }

  async enqueue(event, reason) {
    const items = this.pruneQueue(await this.readQueue());
    if (items.length >= QUEUE_MAX_ITEMS) {
      const removed = items.shift();
      this.debugLog(`queue full; dropped oldest event=${removed?.event?.event ?? 'unknown'} reason=${reason}`);
    }
    items.push({ queuedAt: this.now().toISOString(), event });
    await this.writeQueue(items);
    this.debugLog(`queued event=${event.event} reason=${reason}`);
  }

  async flushQueue(session, config) {
    const items = this.pruneQueue(await this.readQueue());
    if (!items.length) return config;
    const remaining = [];
    let current = config;
    for (const item of items) {
      const result = await this.sendValidated(item.event, session, current, { queueOnFailure: false });
      if (result.sent) {
        current = result.config ?? current;
        continue;
      }
      remaining.push(item);
      this.debugLog(`queue retry deferred event=${item.event.event} reason=${result.reason}`);
      if (result.reason === 'unavailable') break;
    }
    await this.writeQueue(remaining);
    return current;
  }

  async beginCommand(command) {
    if (await this.explicitOptOut()) {
      const current = await this.readConfig();
      if (!current || current.enabled !== false) {
        const disabled = { ...(current ?? defaultConfig({ disclosed: true, graceConsumed: true, installationEventPending: false })), enabled: false, disclosed: true, graceConsumed: true };
        await this.saveConfig(disabled);
      }
      return { command, enabled: false, allowSend: false, allowIdentity: false, installationEventPending: false };
    }

    let config = await this.readConfig();
    if (!config) {
      const existing = await this.hasExistingPrivateState();
      config = defaultConfig({
        enabled: true,
        disclosed: true,
        graceConsumed: true,
        installationEventPending: true,
      });
      this.stderr(TELEMETRY_NOTICE);
      await this.saveConfig(config);
      if (existing) this.debugLog('upgrade without telemetry.json; sending immediately including install event');
    } else if (!config.disclosed) {
      this.stderr(TELEMETRY_NOTICE);
      config.disclosed = true;
      config.graceConsumed = true;
      await this.saveConfig(config);
    } else if (!config.graceConsumed) {
      config.graceConsumed = true;
      await this.saveConfig(config);
    }

    // Identity is never attached to events (privacy). Keep notice once for upgrades that still have identityEnabled.
    if (config.enabled && config.identityEnabled === true && !config.identityDisclosed) {
      this.stderr(IDENTITY_NOTICE);
      config.identityDisclosed = true;
      config.identityEnabled = false;
      await this.saveConfig(config);
    }

    if (config.enabled) {
      try { config = await this.flushQueue({ enabled: true, allowSend: true }, config); } catch (error) {
        this.debugLog(`queue flush failed (${error.message})`);
      }
    }

    return {
      command,
      enabled: config.enabled,
      allowSend: config.enabled,
      allowIdentity: false,
      installationEventPending: config.installationEventPending === true,
    };
  }

  async credentials(config) {
    if (config.installationId && config.token && config.tokenExpiresAt && Date.parse(config.tokenExpiresAt) > this.now().getTime() + 60_000) return config;
    const body = config.installationId && config.token ? { installationId: config.installationId, token: config.token } : {};
    const response = await this.fetchWithRetry(`${this.endpoint}/v1/install`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error('relay unavailable');
    const identity = await response.json();
    const next = { ...config, installationId: identity.installationId, token: identity.token, tokenExpiresAt: identity.expiresAt };
    await this.saveConfig(next);
    return next;
  }

  async fetchWithRetry(url, options) {
    let lastError;
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        return await this.fetch(url, { ...options, signal: AbortSignal.timeout(this.timeoutMs) });
      } catch (error) {
        lastError = error;
        if (attempt === RETRY_DELAYS_MS.length) break;
        await sleep(RETRY_DELAYS_MS[attempt]);
      }
    }
    throw lastError;
  }

  async sendValidated(event, session, config, { queueOnFailure = true } = {}) {
    try {
      if (!session.enabled || !session.allowSend) {
        const reason = session.enabled ? 'grace' : 'disabled';
        this.debugLog(`drop event=${event.event} reason=${reason}`);
        return { sent: false, reason };
      }
      if (!config?.enabled) {
        this.debugLog(`drop event=${event.event} reason=disabled`);
        return { sent: false, reason: 'disabled' };
      }

      let next = await this.credentials(config);
      // Never attach candidate identity to analytics payloads.
      const payload = createTelemetryEnvelope({ installationId: next.installationId, token: next.token, event, skillVersion: SKILL_VERSION });
      let response = await this.fetchWithRetry(`${this.endpoint}/v1/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (response.status === 401) {
        next = { ...next, tokenExpiresAt: null };
        next = await this.credentials(next);
        response = await this.fetchWithRetry(`${this.endpoint}/v1/events`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(createTelemetryEnvelope({ installationId: next.installationId, token: next.token, event, skillVersion: SKILL_VERSION })),
        });
      }
      if (!response.ok) {
        if (queueOnFailure) await this.enqueue(event, `http_${response.status}`);
        this.debugLog(`send failed event=${event.event} status=${response.status}`);
        return { sent: false, reason: 'unavailable', config: next };
      }
      if (event.event === 'installation_started' && next.installationEventPending) {
        next = { ...next, installationEventPending: false };
        await this.saveConfig(next);
        session.installationEventPending = false;
      }
      return { sent: true, config: next };
    } catch (error) {
      if (queueOnFailure) await this.enqueue(event, error.message ?? 'unavailable');
      this.debugLog(`send error event=${event.event} reason=${error.message ?? 'unavailable'}`);
      return { sent: false, reason: 'unavailable', config };
    }
  }

  async record(input, session = { enabled: true, allowSend: true }, { strict = false } = {}) {
    let event;
    try {
      event = await prepareTelemetryInput(input);
    } catch (error) {
      this.debugLog(`schema-invalid event dropped: ${error.message}`);
      if (strict) throw error;
      if (session?.enabled && session?.allowSend) {
        try {
          const counter = validateEvent({
            event: 'skill_error',
            properties: {
              errorCode: 'invalid_input',
              stage: 'application',
              recoverable: true,
              errorCategory: 'schema_invalid',
            },
          });
          await this.sendValidated(counter, session, await this.readConfig(), { queueOnFailure: true });
        } catch { /* counter is best effort */ }
      }
      return { sent: false, reason: 'invalid' };
    }
    const config = await this.readConfig();
    const result = await this.sendValidated(event, session, config, { queueOnFailure: true });
    return { sent: result.sent, reason: result.reason };
  }

  async status() {
    const config = await this.readConfig();
    const optedOut = await this.explicitOptOut();
    return {
      enabled: optedOut ? false : (config?.enabled ?? true),
      disclosed: config?.disclosed ?? false,
      hasInstallationId: Boolean(config?.installationId),
      installationId: config?.installationId ?? null,
      identityEnabled: false,
      identityDisclosed: config?.identityDisclosed ?? false,
      endpoint: this.endpoint,
      schemaVersion: 1,
    };
  }

  async configureIdentity(action) {
    if (action === 'status') return this.status();
    if (!['enable', 'disable'].includes(action)) throw new Error('Identity action must be status, enable, or disable.');
    const current = await this.readConfig() ?? defaultConfig({ disclosed: false, graceConsumed: true, installationEventPending: true });
    // Identity payloads are never sent; keep the control for compatibility and rotate IDs on toggle.
    if ((action === 'enable') !== (current.identityEnabled === true)) {
      Object.assign(current, { installationId: null, token: null, tokenExpiresAt: null });
    }
    current.identityEnabled = false;
    current.identityDisclosed = true;
    await this.saveConfig(current);
    return this.status();
  }

  async configure(action) {
    const current = await this.readConfig() ?? defaultConfig({ disclosed: false, graceConsumed: true, installationEventPending: true });
    if (action === 'status') return this.status();
    if (action === 'enable') {
      current.enabled = true;
      if (!current.installationId) current.installationEventPending = true;
    } else if (action === 'disable') {
      current.enabled = false;
      await this.ensureDirectory();
      await writeFile(this.optOutPath, 'opted-out\n', { mode: 0o600 });
      await chmod(this.optOutPath, 0o600);
    } else if (action === 'reset') {
      Object.assign(current, defaultConfig({ enabled: false, disclosed: true, graceConsumed: true, installationEventPending: false }));
      await this.writeQueue([]);
    } else {
      throw new Error('Telemetry action must be status, enable, disable, or reset.');
    }
    if (action === 'enable') {
      try { await unlink(this.optOutPath); } catch { /* ignore missing opt-out file */ }
    }
    current.disclosed = true;
    await this.saveConfig(current);
    return this.status();
  }

  async preview(input) {
    return prepareTelemetryInput(input);
  }
}

// Re-export for tests that still import identity helpers through the client surface.
export { validateTelemetryIdentity };
