import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import {
    sanitizeHexStr,
    IPV4_PATTERN,
    IPV6_PATTERN,
    MAC_PATTERN,
    URL_PATTERN,
    EMAIL_PATTERN,
    IBAN_PATTERN,
    UUID_PATTERN,
    HEX_COLOR_PATTERN,
    DATE_PATTERN,
    PHONE_PATTERN,
    NUMBER_PATTERN
} from './smartpatterns.js';

// =======================================================================
// SMART EXTRACTORS DEFINITION
// =======================================================================

const SMART_EXTRACTORS = [
    {
        id: 'clean_text',
        get label() { return _('Copy Clean Text'); },
        icon: 'edit-clear-all-symbolic',
        regex: /[\s\S]+/g, // Process the entire text as a single block
        sanitize(str) {
            let lines = str.split('\n');
            let cleanedLines = lines.map(line => {
                let tokens = line.trim().split(/\s+/);
                if (tokens.length === 0) return '';
                
                let tokenQualities = tokens.map(t => {
                    // Connecting punctuation
                    if (/^[-:|]$/.test(t)) return 1;
                    
                    let alphaNum = (t.match(/[a-zA-Z0-9]/g) || []).length;
                    if (alphaNum === 0) return 0;
                    
                    // Allow CLI flags like -m, --force
                    if (/^[-/]{1,2}[a-zA-Z0-9]+$/.test(t)) return 2;
                    
                    // Check isolated single characters (keep a, A, I, or digits)
                    if (t.length === 1) return /^[aAI0-9]$/.test(t) ? 2 : 0;
                    
                    // UI gibberish like xX, mM (mixed casing for 2 chars)
                    let letters = t.replace(/[^a-zA-Z]/g, '');
                    if (letters.length === 2 && letters[0].toLowerCase() === letters[1].toLowerCase() && letters[0] !== letters[1]) return 0;
                    
                    // High-density symbol clusters
                    if (alphaNum / t.length < 0.5) return 0;
                    
                    // Filter out consonant-only gibberish (Ss, Pp, cs) but retain valid Acronyms (HTTP, XML)
                    let hasVowelOrDigit = /[aeiouyAEIOUY0-9]/.test(t);
                    let isAcronym = letters.length > 0 && /^[A-Z]+$/.test(letters);
                    
                    if (!hasVowelOrDigit && !isAcronym && letters.length <= 2) return 0;
                    
                    return 2;
                });
                
                // Find the longest sequence of solid words (allowing safe punctuation in between)
                let bestStart = -1, bestEnd = -1, maxScore = -1;
                for (let i = 0; i < tokens.length; i++) {
                    if (tokenQualities[i] === 2) {
                        for (let j = i; j < tokens.length; j++) {
                            if (tokenQualities[j] === 2) {
                                let valid = true;
                                let score = 0;
                                for (let k = i; k <= j; k++) {
                                    if (tokenQualities[k] === 0) {
                                        valid = false; break;
                                    }
                                    if (tokenQualities[k] === 2) score += tokens[k].length;
                                }
                                if (valid && score > maxScore) {
                                    maxScore = score;
                                    bestStart = i;
                                    bestEnd = j;
                                }
                            }
                        }
                    }
                }
                
                if (bestStart !== -1 && bestEnd !== -1) {
                    return tokens.slice(bestStart, bestEnd + 1).join(' ');
                }
                return '';
            });
            
            return cleanedLines.filter(l => l.length > 0).join('\n');
        },
        confidence(str, original) {
            if (str.length < 4) return 0.0;
            
            // Prevent huge blocks of text from cluttering the smart menu
            if (str.split('\n').length > 3) return 0.0;
            
            let origTrimmed = original.trim();
            let removedChars = origTrimmed.length - str.length;
            
            // Ensure we successfully isolated text by aggressively stripping visual artifacts
            if (removedChars >= 3 && str !== origTrimmed && str.length > 0) {
                return 0.85;
            }
            
            return 0.0;
        }
    },
    {
        id: 'url',
        get label() { return _('Copy Link'); },
        icon: 'emblem-web-symbolic',
        regex: new RegExp(URL_PATTERN, 'gi'),
        sanitize(str) {
            return str.trim();
        },
        confidence() {
            return 1.0;
        },
        buildUri(str) {
            // URL pattern already requires http:// or https://
            return str;
        }
    },
    {
        id: 'email',
        get label() { return _('Copy Email'); },
        icon: 'mail-unread-symbolic',
        regex: new RegExp(EMAIL_PATTERN, 'gi'),
        sanitize(str) {
            return str.replace(/[^a-zA-Z0-9._%+-@]/g, '');
        },
        confidence(str) {
            if (str.includes('@') && str.includes('.')) {
                return 1.0;
            }
            return 0.0;
        },
        buildUri(str) {
            return `mailto:${str}`;
        }
    },
    {
        id: 'ipv4',
        get label() { return _('Copy IPv4'); },
        icon: 'network-wired-symbolic',
        regex: new RegExp(IPV4_PATTERN, 'g'),
        sanitize(str) {
            return str.replace(/\s+/g, '').replace(/[^0-9.\/]/g, '');
        },
        confidence(str) {
            const [ip, subnet] = str.split('/');
            const parts = ip.split('.');
            
            if (parts.length !== 4) return 0;
            
            const isValidIP = parts.every(p => p !== '' && !isNaN(p) && p >= 0 && p <= 255);
            if (!isValidIP) return 0;
            
            if (subnet !== undefined) {
                const sub = parseInt(subnet, 10);
                if (isNaN(sub) || sub < 0 || sub > 32) return 0;
            }
            
            // Filter out likely internal version numbers (e.g., 1.0.0.0) from randomly triggering
            const ignoredIPs = ['0.0.0.0', '1.0.0.0', '1.2.3.4'];
            if (ignoredIPs.includes(ip)) {
                return 0.4;
            }
            
            return 1.0;
        },
        buildUri(str) {
            // Strip subnet mask if present
            const ip = str.split('/')[0];
            return `http://${ip}`;
        }
    },
    {
        id: 'ipv6',
        get label() { return _('Copy IPv6'); },
        icon: 'network-server-symbolic',
        regex: new RegExp(IPV6_PATTERN, 'gi'),
        sanitize(str) {
            let s = str.replace(/\s+/g, '');
            s = sanitizeHexStr(s);
            return s.replace(/[^0-9a-f:\/%_a-z]/gi, '').toLowerCase();
        },
        confidence(str) {
            if (str === '::' || str === '::/0') return 0;
            
            const [ipPart, subnet] = str.split('/');
            const [ip, scope] = ipPart.split('%');
            const parts = ip.split(':');
            
            if (parts.length <= 2) return 0;
            
            if (subnet !== undefined) {
                const sub = parseInt(subnet, 10);
                if (isNaN(sub) || sub < 0 || sub > 128) return 0;
            }
            
            return 1.0;
        },
        buildUri(str) {
            // Strip subnet mask and interface scope, then wrap in standard IPv6 brackets
            const ip = str.split('/')[0].split('%')[0];
            return `http://[${ip}]`;
        }
    },
    {
        id: 'mac',
        get label() { return _('Copy MAC Address'); },
        icon: 'network-workgroup-symbolic',
        regex: new RegExp(MAC_PATTERN, 'gi'),
        sanitize(str) {
            let s = str.replace(/\s+/g, '');
            s = sanitizeHexStr(s);
            return s.replace(/[^0-9a-f:-]/gi, '').toUpperCase();
        },
        confidence() {
            return 1.0;
        }
    },
    {
        id: 'iban',
        get label() { return _('Copy Number'); },
        icon: 'accessories-calculator-symbolic',
        regex: new RegExp(IBAN_PATTERN, 'gi'),
        sanitize(str) {
            return str.replace(/[^A-Z0-9]/gi, '').toUpperCase();
        },
        confidence(str) {
            return str.length >= 15 ? 1.0 : 0.0;
        }
    },
    {
        id: 'uuid',
        get label() { return _('Copy UUID'); },
        icon: 'fingerprint-symbolic',
        regex: new RegExp(UUID_PATTERN, 'gi'),
        sanitize(str) {
            return str.replace(/[^0-9a-fA-F-]/g, '').toLowerCase();
        },
        confidence() {
            return 1.0;
        }
    },
    {
        id: 'hex_color',
        get label() { return _('Copy Hex Color'); },
        icon: 'color-select-symbolic',
        regex: new RegExp(HEX_COLOR_PATTERN, 'gi'),
        sanitize(str) {
            let s = sanitizeHexStr(str);
            return s.replace(/[^a-fA-F0-9#]/gi, '').toUpperCase();
        },
        confidence() {
            return 1.0;
        }
    },
    {
        id: 'date',
        get label() { return _('Copy Date'); },
        icon: 'x-office-calendar-symbolic',
        regex: new RegExp(DATE_PATTERN, 'gi'),
        sanitize(str) {
            return str.replace(/[^0-9\-/]/g, '');
        },
        confidence() {
            return 1.0;
        }
    },
    {
        id: 'phone',
        get label() { return _('Copy Phone'); },
        icon: 'call-start-symbolic',
        regex: new RegExp(PHONE_PATTERN, 'gi'),
        sanitize(str) {
            return str.replace(/[^\d+]/g, '');
        },
        confidence(str, original) {
            // Heavily penalize if it contains IP address, Time, MAC, or Date delimiters
            const dotCount = (original.match(/\./g) || []).length;
            const colonCount = (original.match(/:/g) || []).length;
            const slashCount = (original.match(/\//g) || []).length;

            if (dotCount >= 2 || colonCount >= 2 || slashCount >= 1) {
                return 0.0;
            }

            const cleaned = str.replace(/[^\d+]/g, '');
            if (cleaned.length < 7 || cleaned.length > 15) {
                return 0.0;
            }

            // If it has formatting like spaces or dashes, it's more likely a real phone number
            const hasFormatting = /[\s-]/.test(original.trim());
            
            if (cleaned.startsWith('+') || cleaned.startsWith('00')) {
                return 0.9;
            }
            
            if (hasFormatting) {
                return 0.7;
            }
            
            // Allow raw 10-11 digit numbers starting with 0 (e.g., standard Dutch 0612437418 or UK)
            if (cleaned.startsWith('0') && cleaned.length >= 10 && cleaned.length <= 11) {
                return 0.8;
            }
            
            // If it's just a raw number with no formatting, lower confidence to avoid gibberish matching
            return 0.4;
        },
        buildUri(str) {
            const cleaned = str.replace(/[^\d+]/g, '');
            return `tel:${cleaned}`;
        }
    },
    {
        id: 'number',
        get label() { return _('Copy Number'); },
        icon: 'accessories-calculator-symbolic',
        regex: new RegExp(NUMBER_PATTERN, 'gi'),
        sanitize(str) {
            return str.replace(/[^\d]/g, '');
        },
        confidence(str, original) {
            let cleaned = str.replace(/[^\d]/g, '');
            if (cleaned.length < 5) return 0.0;
            
            // Heavily penalize if it strongly resembles a date, time, or phone format to prevent overlap.
            const hasMultipleDelimiters = (original.match(/[-./]/g) || []).length >= 2;
            if (hasMultipleDelimiters) return 0.2;

            // If it's a longer string of numbers (like a tracking ID or product number), highly confident.
            if (cleaned.length >= 8) return 0.6;
            
            return 0.4;
        }
    }
];

export function extractSmartEntities(text) {
    const results = [];
    const seenValues = new Set();

    for (const extractor of SMART_EXTRACTORS) {
        const matches = text.match(extractor.regex);
        
        if (!matches) continue;

        for (const match of matches) {
            const original = match;
            const sanitized = extractor.sanitize ? extractor.sanitize(match) : match;
            const confidence = extractor.confidence ? extractor.confidence(sanitized, original) : 1.0;

            if (confidence >= 0.5 && !seenValues.has(sanitized)) {
                seenValues.add(sanitized);
                
                let matchLabel = sanitized;
                if (matchLabel.length > 25) {
                    matchLabel = matchLabel.substring(0, 25) + '...';
                }

                results.push({
                    id: extractor.id,
                    label: extractor.label,
                    icon: extractor.icon,
                    value: sanitized,
                    matchLabel: matchLabel,
                    confidence: confidence,
                    uri: extractor.buildUri ? extractor.buildUri(sanitized) : null
                });
            }
        }
    }

    // Sort the matches by highest confidence
    results.sort((a, b) => b.confidence - a.confidence);
    
    return results;
}