// Copyright (c) 2024-2026 Soumya Debnath <soumyadebnath1619@gmail.com>. All rights reserved.
// Business Source License 1.1 (BSL 1.1) — Commercial License Key Validator

export interface LicenseValidationOptions {
  licenseKey?: string;
  allowEval?: boolean;
}

/**
 * Read process.env without requiring @types/node.
 * The previous bare `process` references made `npm run typecheck` fail with four
 * TS2580 errors ("Cannot find name 'process'").
 */
function readEnv(name: string): string | undefined {
  const proc = (globalThis as any).process;
  return proc && proc.env ? proc.env[name] : undefined;
}

export class LicenseValidator {
  private static readonly AUTHOR = 'Soumya Debnath';
  private static readonly CONTACT = 'soumyadebnath1619@gmail.com';
  /** The banner is informational; print it once per process, not once per instance. */
  private static warned = false;

  public static validate(options?: LicenseValidationOptions): boolean {
    const key = options?.licenseKey || readEnv('COMMERCIAL_LICENSE_KEY');

    // Development / localhost evaluation bypass.
    const isDev = typeof window !== 'undefined'
      ? window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
      : readEnv('NODE_ENV') !== 'production';

    if (isDev || options?.allowEval) {
      return true;
    }

    if (!key || !key.startsWith('BSL11-')) {
      // Printed once. It used to fire on every `new SyncPlay(...)` and included the
      // author's personal phone number, which shipped in dist/ and was therefore
      // emitted into every end user's browser console via the jsDelivr CDN.
      if (!LicenseValidator.warned) {
        LicenseValidator.warned = true;
        console.warn(
          '\n================================================================================\n' +
          'COMMERCIAL USE NOTICE — BUSINESS SOURCE LICENSE 1.1\n' +
          `Product: SYNCPLAY | Copyright (c) 2024-2026 ${LicenseValidator.AUTHOR}\n\n` +
          'Production use of this software requires a valid paid commercial license key.\n' +
          'See LICENSE and COMMERCIAL_LICENSE.md for the terms.\n\n' +
          `Commercial licensing enquiries: ${LicenseValidator.CONTACT}\n` +
          '================================================================================\n'
        );
      }
      return false;
    }

    return true;
  }
}
