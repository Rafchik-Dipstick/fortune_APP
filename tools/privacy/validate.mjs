#!/usr/bin/env node
// Asserts that the shipped iOS configuration asks for exactly the capabilities
// and permissions Fortuneness actually uses, and that the privacy manifest
// stays consistent with docs/app-privacy-worksheet.md (spec Phase 12).
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const mobileRoot = path.join(repositoryRoot, 'apps', 'mobile');

/**
 * Fortuneness shows no camera, microphone, photo, location, contacts, or
 * tracking prompt, so any usage-description string in the shipped Info.plist
 * would be asking for something the app never uses.
 */
const forbiddenInfoPlistKeyPattern = /UsageDescription$|^NSUserTrackingUsageDescription$/u;

/** Entitlements Fortuneness must never ship. Remote push is the notable one. */
const forbiddenPluginPattern = /push|notification-service|background-fetch|location/iu;

const requiredPlugins = [
  './plugins/with-game-center.cjs',
  './plugins/with-local-notifications-only.cjs',
];

const requiredAccessedApiTypes = new Set([
  'NSPrivacyAccessedAPICategoryFileTimestamp',
  'NSPrivacyAccessedAPICategoryUserDefaults',
  'NSPrivacyAccessedAPICategoryDiskSpace',
]);

const failures = [];

function fail(message) {
  failures.push(message);
}

function readExpoConfig() {
  // The CLI entry is invoked directly rather than through npx so the check
  // behaves the same on Windows, where spawning a .cmd shim is blocked.
  const expoCli = path.join(repositoryRoot, 'node_modules', 'expo', 'bin', 'cli');
  const stdout = execFileSync(process.execPath, [expoCli, 'config', '--type', 'public', '--json'], {
    cwd: mobileRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const start = stdout.indexOf('{');
  if (start < 0) {
    throw new Error('expo config did not return a JSON object.');
  }
  return JSON.parse(stdout.slice(start));
}

function pluginName(plugin) {
  return Array.isArray(plugin) ? String(plugin[0]) : String(plugin);
}

function validatePlugins(config) {
  const names = (config.plugins ?? []).map(pluginName);
  for (const required of requiredPlugins) {
    if (!names.includes(required)) {
      fail(`The ${required} config plugin must stay enabled.`);
    }
  }
  for (const name of names) {
    if (forbiddenPluginPattern.test(name)) {
      fail(`The ${name} config plugin adds a capability Fortuneness does not use.`);
    }
  }
}

function validateInfoPlist(config) {
  for (const key of Object.keys(config.ios?.infoPlist ?? {})) {
    if (forbiddenInfoPlistKeyPattern.test(key)) {
      fail(`Info.plist declares ${key}, but Fortuneness never presents that prompt.`);
    }
  }
  const entitlements = Object.keys(config.ios?.entitlements ?? {});
  if (entitlements.includes('aps-environment')) {
    fail('The remote push entitlement must stay removed; reminders are local notifications.');
  }
}

function validatePrivacyManifest(config) {
  const manifest = config.ios?.privacyManifests;
  if (manifest === undefined) {
    fail('ios.privacyManifests is required so prebuild emits PrivacyInfo.xcprivacy.');
    return;
  }
  if (manifest.NSPrivacyTracking !== false) {
    fail('NSPrivacyTracking must be false; Fortuneness does not track across apps or websites.');
  }
  if ((manifest.NSPrivacyTrackingDomains ?? []).length > 0) {
    fail('NSPrivacyTrackingDomains must stay empty.');
  }
  const collected = manifest.NSPrivacyCollectedDataTypes ?? [];
  if (collected.length === 0) {
    fail('NSPrivacyCollectedDataTypes must describe what the backend actually stores.');
  }
  for (const entry of collected) {
    if (entry.NSPrivacyCollectedDataTypeTracking !== false) {
      fail(`${entry.NSPrivacyCollectedDataType} must not be marked as used for tracking.`);
    }
    if (
      !(entry.NSPrivacyCollectedDataTypePurposes ?? []).includes(
        'NSPrivacyCollectedDataTypePurposeAppFunctionality',
      )
    ) {
      fail(
        `${entry.NSPrivacyCollectedDataType} must be collected for app functionality, not another purpose.`,
      );
    }
  }
  const declared = new Set(
    (manifest.NSPrivacyAccessedAPITypes ?? []).map((entry) => entry.NSPrivacyAccessedAPIType),
  );
  for (const required of requiredAccessedApiTypes) {
    if (!declared.has(required)) {
      fail(`The privacy manifest must declare a reason for ${required}.`);
    }
  }
  for (const entry of manifest.NSPrivacyAccessedAPITypes ?? []) {
    if ((entry.NSPrivacyAccessedAPITypeReasons ?? []).length === 0) {
      fail(`${entry.NSPrivacyAccessedAPIType} needs at least one approved reason code.`);
    }
  }
}

const config = readExpoConfig();
validatePlugins(config);
validateInfoPlist(config);
validatePrivacyManifest(config);

if (failures.length > 0) {
  console.error('Privacy and capability validation failed:');
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    'Privacy and capability validation passed: no unused prompts, no remote push, no tracking.',
  );
}
