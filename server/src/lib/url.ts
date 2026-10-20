import { config } from '../config.js';
import { MAX_URL_LENGTH, validateDestination as validate, type UrlCheck } from '../shared/validation.js';

export { MAX_URL_LENGTH, type UrlCheck };

/** Structural validation only. It never fetches the URL (no SSRF surface). */
export function validateDestination(input: unknown): UrlCheck {
  return validate(input, new URL(config.shortBaseUrl).host);
}
