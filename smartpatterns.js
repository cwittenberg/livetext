// For HEX recognition (so colors for example) Tesseract annoyingly 
// mistakes certain letters for numbers and vice versa.
// No other option but to replace for color hexes and IPv6/MAC addresses.
export const HEX_HALLUCINATIONS = {
    'S': '5', 's': '5', 
    'O': '0', 'o': '0', 
    'I': '1', 'i': '1',
    'L': '1', 'l': '1', 
    'Z': '2', 'z': '2', 
    'G': '6', 'g': '6',
    'T': '7', 't': '7', 
    'Q': '0', 'q': '0'
};

export function sanitizeHexStr(str) {
    return str.replace(/[SOILZGTQsoilzgtq]/g, match => HEX_HALLUCINATIONS[match]);
}

// =======================================================================
// PRE-COMPILED REGULAR EXPRESSIONS
// For performance pretty good to do so.
// =======================================================================

// Tolerant regex patterns for OCR - where spaces get inserted by Tesseract (like IPs with spaces in them)
export const HEX_CHAR_PATTERN = "[0-9a-fA-FSOILZGTQsoilzgtq]";

export const IPV4_PATTERN = [
    "(?<![0-9.])",                                                 // Negative lookbehind
    "(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\s*\\.\\s*){3}",  // First 3 octets
    "(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)",                    // Last octet
    "(?:\\s*/\\s*(?:3[0-2]|[1-2]?[0-9]))?",                        // Optional subnet mask
    "(?![0-9.])"                                                   // Negative lookahead
].join('');

// IPv6 matching is notoriously ugly, so we break the groups down for readability
const IPV6_GROUPS = [
    `(?:${HEX_CHAR_PATTERN}{1,4}:){7,7}${HEX_CHAR_PATTERN}{1,4}`,
    `(?:${HEX_CHAR_PATTERN}{1,4}:){1,7}:`,
    `(?:${HEX_CHAR_PATTERN}{1,4}:){1,6}:${HEX_CHAR_PATTERN}{1,4}`,
    `(?:${HEX_CHAR_PATTERN}{1,4}:){1,5}(?::${HEX_CHAR_PATTERN}{1,4}){1,2}`,
    `(?:${HEX_CHAR_PATTERN}{1,4}:){1,4}(?::${HEX_CHAR_PATTERN}{1,4}){1,3}`,
    `(?:${HEX_CHAR_PATTERN}{1,4}:){1,3}(?::${HEX_CHAR_PATTERN}{1,4}){1,4}`,
    `(?:${HEX_CHAR_PATTERN}{1,4}:){1,2}(?::${HEX_CHAR_PATTERN}{1,4}){1,5}`,
    `${HEX_CHAR_PATTERN}{1,4}:(?:(?::${HEX_CHAR_PATTERN}{1,4}){1,6})`,
    `:(?:(?::${HEX_CHAR_PATTERN}{1,4}){1,7}|:)`
].join('|');

const IPV6_SUFFIX = `(?:%[a-zA-Z0-9_]+)?(?:/(?:12[0-8]|1[0-1][0-9]|[1-9]?[0-9]))?`;
const IPV6_FULL_BASE = `(?:${IPV6_GROUPS})${IPV6_SUFFIX}`;

// Safely inject \s* around literal colons without breaking non-capturing groups (?:)
export const IPV6_PATTERN = `(?<!${HEX_CHAR_PATTERN}|:)` + 
    `(?:` + IPV6_FULL_BASE.replace(/\(\?:/g, '___NONCAP___')
                          .replace(/:/g, '\\s*:\\s*')
                          .replace(/___NONCAP___/g, '(?:')
                          .replace(/\//g, '\\s*/\\s*') + `)` + 
    `(?!${HEX_CHAR_PATTERN}|:)`;

export const MAC_PATTERN = [
    `(?<!${HEX_CHAR_PATTERN}|[:\\-])`,                                      // Negative lookbehind
    `(?:${HEX_CHAR_PATTERN}{2}(?:\\s*[:\\-]\\s*)){5}${HEX_CHAR_PATTERN}{2}`,// 6 pairs of hex digits
    `(?!${HEX_CHAR_PATTERN}|[:\\-])`                                        // Negative lookahead
].join('');

export const URL_PATTERN = [
    '(?<![a-zA-Z0-9])',                   // Negative lookbehind
    'https?:\\/\\/',                      // Protocol (http:// or https://)
    '(?:www\\.)?',                        // Optional www.
    '[-a-zA-Z0-9@:%._\\+~#=]{1,256}',     // Domain name characters
    '\\.[a-zA-Z0-9()]{1,6}\\b',           // Top-level domain
    '(?:[-a-zA-Z0-9()@:%_\\+.~#?&\\/=]*)' // Optional path and query parameters
].join('');

export const EMAIL_PATTERN = [
    '(?<![a-zA-Z0-9._%+-])',              // Negative lookbehind
    '[a-zA-Z0-9._%+-]+',                  // Local part (username)
    '@',                                  // At symbol
    '[a-zA-Z0-9.-]+',                     // Domain part
    '\\.[a-zA-Z]{2,}',                    // Top-level domain
    '(?![a-zA-Z0-9])'                     // Negative lookahead
].join('');

export const IBAN_PATTERN = [
    '(?<![A-Z0-9])',                      // Negative lookbehind
    '[A-Z]{2}',                           // Country code
    '\\d{2}',                             // Check digits
    '(?:[ \\-]?[A-Z0-9]){11,30}',         // 11 to 30 alphanumeric characters, optionally separated by spaces or dashes
    '(?![A-Z0-9])'                        // Negative lookahead
].join('');

export const UUID_PATTERN = [
    '(?<![0-9a-fA-F\\-])',                // Negative lookbehind
    '[0-9a-fA-F]{8}',                     // 8 hex chars
    '-[0-9a-fA-F]{4}',                    // 4 hex chars
    '-[0-9a-fA-F]{4}',                    // 4 hex chars
    '-[0-9a-fA-F]{4}',                    // 4 hex chars
    '-[0-9a-fA-F]{12}',                   // 12 hex chars
    '(?![0-9a-fA-F\\-])'                  // Negative lookahead
].join('');

export const HEX_COLOR_PATTERN = [
    '(?<![a-zA-Z0-9])',                   // Negative lookbehind
    '#',                                  // Hash symbol
    `(?:${HEX_CHAR_PATTERN}{6}|${HEX_CHAR_PATTERN}{3})`,    // 6 or 3 hex chars (hallucination tolerant)
    '(?![a-zA-Z0-9])'                     // Negative lookahead
].join('');

export const DATE_PATTERN = [
    '(?<!\\d)',                           // Negative lookbehind for digit
    '(?:',
        '\\d{4}[-/]\\d{2}[-/]\\d{2}',     // yyyy-mm-dd or yyyy/mm/dd
        '|',
        '\\d{2}[-/]\\d{2}[-/]\\d{4}',     // dd-mm-yyyy or dd/mm/yyyy
    ')',
    '(?!\\d)'                             // Negative lookahead for digit
].join('');

export const PHONE_PATTERN = [
    '(?<!\\d)',                           // Negative lookbehind for digit
    '(?:(?:\\+|00)\\d{1,3}[\\s-]?)?',     // Optional country code
    '(?:\\(?[0-9]{1,4}\\)?[\\s-]?)?',     // Optional area code
    '(?:\\d[\\s-]?){6,10}',               // 6 to 10 digits
    '(?!\\d)'                             // Negative lookahead for digit
].join('');

export const NUMBER_PATTERN = [
    '(?<![a-zA-Z0-9])',                           // Negative lookbehind for digit/letter
    '\\d(?:[\\s\\-._]?\\d){4,}',                  // 5+ digits, optionally separated by single space, dash, dot, or underscore
    '(?![a-zA-Z0-9])'                             // Negative lookahead for digit/letter
].join('');