import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

// Standard native button helper
function createLinkButton(title, uri, styleClass = null) {
    const button = new Gtk.Button({
        label: title,
        valign: Gtk.Align.CENTER,
        hexpand: true
    });
    
    if (styleClass) {
        button.add_css_class(styleClass);
    }
    
    button.connect('clicked', () => {
        Gio.AppInfo.launch_default_for_uri(uri, null);
    });
    
    return button;
}

export default class SnapTextPreferences extends ExtensionPreferences {
    _createShortcutRow(settings, window, title, subtitle, enableKey, shortcutKey, defaultAccel) {
        const row = new Adw.ActionRow({
            title: title,
            subtitle: subtitle,
            title_lines: 0,
            subtitle_lines: 0
        });
        
        if (enableKey) {
            settings.bind(enableKey, row, 'sensitive', Gio.SettingsBindFlags.GET);
            settings.connect(`changed::${enableKey}`, () => {
                if (settings.get_boolean(enableKey)) {
                    let current = settings.get_strv(shortcutKey);
                    if (!current || current.length === 0 || current[0] === '') {
                        settings.set_strv(shortcutKey, [defaultAccel]);
                        shortcutLabel.set_accelerator(defaultAccel);
                    }
                }
            });
        }
        
        const shortcutLabel = new Gtk.ShortcutLabel({
            disabled_text: _('Disabled'),
            accelerator: settings.get_strv(shortcutKey)[0] || '',
            valign: Gtk.Align.CENTER
        });

        const shortcutButton = new Gtk.Button({
            child: shortcutLabel,
            valign: Gtk.Align.CENTER
        });
        
        let isRecording = false;
        shortcutButton.connect('clicked', () => {
            if (isRecording) {
                isRecording = false;
                shortcutButton.remove_css_class('suggested-action');
                shortcutLabel.set_accelerator(settings.get_strv(shortcutKey)[0] || '');
            } else {
                isRecording = true;
                shortcutButton.add_css_class('suggested-action');
                shortcutLabel.set_accelerator('');
                shortcutLabel.set_disabled_text(_('Press keys...'));
            }
        });
        
        const keyController = new Gtk.EventControllerKey();
        keyController.set_propagation_phase(Gtk.PropagationPhase.CAPTURE);
        window.add_controller(keyController);
        
        keyController.connect('key-pressed', (controller, keyval, keycode, state) => {
            if (!isRecording) return false;
            
            if (keyval === Gdk.KEY_Escape) {
                isRecording = false;
                shortcutButton.remove_css_class('suggested-action');
                shortcutLabel.set_accelerator(settings.get_strv(shortcutKey)[0] || '');
                return true;
            }
            
            if (keyval === Gdk.KEY_BackSpace) {
                isRecording = false;
                settings.set_strv(shortcutKey, ['']);
                shortcutButton.remove_css_class('suggested-action');
                shortcutLabel.set_accelerator('');
                shortcutLabel.set_disabled_text(_('Disabled'));
                return true;
            }
            
            let isModifier = (
                keyval === Gdk.KEY_Alt_L || keyval === Gdk.KEY_Alt_R ||
                keyval === Gdk.KEY_Control_L || keyval === Gdk.KEY_Control_R ||
                keyval === Gdk.KEY_Shift_L || keyval === Gdk.KEY_Shift_R ||
                keyval === Gdk.KEY_Super_L || keyval === Gdk.KEY_Super_R ||
                keyval === Gdk.KEY_Meta_L || keyval === Gdk.KEY_Meta_R
            );
            
            if (isModifier) {
                return true; // Consume event but wait for the non-modifier key
            }
            
            let mask = state & Gtk.accelerator_get_default_mod_mask();
            let accelName = Gtk.accelerator_name(keyval, mask);
            
            // Bypass Gtk.accelerator_valid() to permit single-key and simple two-key shortcuts without arbitrary restriction
            if (accelName && accelName.length > 0) {
                settings.set_strv(shortcutKey, [accelName]);
                isRecording = false;
                shortcutButton.remove_css_class('suggested-action');
                shortcutLabel.set_accelerator(accelName);
                return true;
            }
            
            return true;
        });

        row.add_suffix(shortcutButton);
        row.activatable_widget = shortcutButton;
        
        return row;
    }

    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        
        const pageGeneral = new Adw.PreferencesPage({
            title: _('General'),
            icon_name: 'preferences-system-symbolic'
        });
        
        const groupHeader = new Adw.PreferencesGroup();
        const descLabel = new Gtk.Label({
            label: _('Instantly extract and copy text to your clipboard from anywhere on the screen.'),
            justify: Gtk.Justification.CENTER,
            wrap: true,
            margin_top: 5,
            margin_bottom: 5,
            css_classes: ['dim-label']
        });
        groupHeader.add(descLabel);
        pageGeneral.add(groupHeader);
        
        const groupUI = new Adw.PreferencesGroup({
            title: _('System Tray & UI')
        });

        const trayRow = new Adw.ActionRow({
            title: _('Show Tray Icon'),
            subtitle: _('Display the extension icon in the system top panel.'),
            title_lines: 0, subtitle_lines: 0
        });
        const toggleTray = new Gtk.Switch({
            active: settings.get_boolean('show-tray-icon'),
            valign: Gtk.Align.CENTER,
        });
        settings.bind('show-tray-icon', toggleTray, 'active', Gio.SettingsBindFlags.DEFAULT);
        trayRow.add_suffix(toggleTray);
        trayRow.activatable_widget = toggleTray;
        groupUI.add(trayRow);

        const notificationRow = new Adw.ActionRow({
            title: _('Show Extracted Text Notification'),
            subtitle: _('Displays a system banner containing your copied text context.'),
            title_lines: 0, subtitle_lines: 0
        });
        const toggleNotification = new Gtk.Switch({
            active: settings.get_boolean('show-notification'),
            valign: Gtk.Align.CENTER,
        });
        settings.bind('show-notification', toggleNotification, 'active', Gio.SettingsBindFlags.DEFAULT);
        notificationRow.add_suffix(toggleNotification);
        notificationRow.activatable_widget = toggleNotification;
        groupUI.add(notificationRow);
        
        const historyRow = new Adw.ActionRow({
            title: _('Enable Extraction History'),
            subtitle: _('Keep a history of up to 15 recent extractions in the context menu.'),
            title_lines: 0, subtitle_lines: 0
        });
        const toggleHistory = new Gtk.Switch({
            active: settings.get_boolean('keep-history'),
            valign: Gtk.Align.CENTER,
        });
        settings.bind('keep-history', toggleHistory, 'active', Gio.SettingsBindFlags.DEFAULT);
        historyRow.add_suffix(toggleHistory);
        historyRow.activatable_widget = toggleHistory;
        groupUI.add(historyRow);
        
        pageGeneral.add(groupUI);

        const groupArea = new Adw.PreferencesGroup({
            title: _('Area Extraction')
        });

        const enableShortcutRow = new Adw.ActionRow({
            title: _('Enable Area Selection Shortcut'),
            subtitle: _('Trigger crosshair to draw a box around text to extract.'),
            title_lines: 0, subtitle_lines: 0
        });
        const toggleShortcut = new Gtk.Switch({
            active: settings.get_boolean('enable-shortcut'),
            valign: Gtk.Align.CENTER,
        });
        settings.bind('enable-shortcut', toggleShortcut, 'active', Gio.SettingsBindFlags.DEFAULT);
        enableShortcutRow.add_suffix(toggleShortcut);
        enableShortcutRow.activatable_widget = toggleShortcut;
        groupArea.add(enableShortcutRow);

        const shortcutRow = this._createShortcutRow(
            settings, window, 
            _('Area Selection Shortcut'), 
            _('Click to set shortcut. Press Esc to cancel, Backspace to disable.'),
            'enable-shortcut', 'shortcut-trigger', '<Control><Shift>t'
        );
        groupArea.add(shortcutRow);

        pageGeneral.add(groupArea);

        const groupSmart = new Adw.PreferencesGroup({
            title: _('Smart Extraction'),
            description: _('Smart extraction instantly reads text, parses links, and detects data directly beneath your cursor without needing to draw a box.')
        });

        const smartClickRow = new Adw.ActionRow({
            title: _('Enable Smart Extraction'),
            subtitle: _('Master toggle for pointer-based text extraction features.'),
            title_lines: 0, subtitle_lines: 0
        });
        const toggleSmartClick = new Gtk.Switch({
            active: settings.get_boolean('enable-smart-click'),
            valign: Gtk.Align.CENTER,
        });
        settings.bind('enable-smart-click', toggleSmartClick, 'active', Gio.SettingsBindFlags.DEFAULT);
        smartClickRow.add_suffix(toggleSmartClick);
        smartClickRow.activatable_widget = toggleSmartClick;
        groupSmart.add(smartClickRow);

        const clickSnapRow = new Adw.ActionRow({
            title: _('Single-Click Smart Snap'),
            subtitle: _('Extract text at the pointer location with a single click instead of dragging a box.'),
            title_lines: 0, subtitle_lines: 0
        });
        const toggleClickSnap = new Gtk.Switch({
            active: settings.get_boolean('click-to-smart-snap'),
            valign: Gtk.Align.CENTER,
        });
        settings.bind('click-to-smart-snap', toggleClickSnap, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('enable-smart-click', clickSnapRow, 'sensitive', Gio.SettingsBindFlags.GET);
        clickSnapRow.add_suffix(toggleClickSnap);
        clickSnapRow.activatable_widget = toggleClickSnap;
        groupSmart.add(clickSnapRow);

        const smartShortcutRow = this._createShortcutRow(
            settings, window, 
            _('Smart Extraction Shortcut'), 
            _('Key combination to trigger extraction exactly at pointer location.'),
            'enable-smart-click', 'smart-shortcut-trigger', '<Control><Shift>e'
        );
        groupSmart.add(smartShortcutRow);

        pageGeneral.add(groupSmart);

        const groupLinks = new Adw.PreferencesGroup();
        const linkBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 12,
            homogeneous: true,
            halign: Gtk.Align.CENTER,
            margin_top: 16,
            margin_bottom: 16
        });
        linkBox.append(createLinkButton(_('Buy me a coffee \u2615'), 'https://ko-fi.com/cwittenberg', 'suggested-action'));
        linkBox.append(createLinkButton(_('Report a Bug \uD83D\uDC1E'), 'https://github.com/cwittenberg/snaptext/issues/new?template=bug_report.md'));
        linkBox.append(createLinkButton(_('Request a Feature \uD83D\uDCA1'), 'https://github.com/cwittenberg/snaptext/issues/new?template=feature_request.md'));
        groupLinks.add(linkBox);
        
        pageGeneral.add(groupLinks);
        window.add(pageGeneral);

        const pageAdvanced = new Adw.PreferencesPage({
            title: _('Advanced'),
            icon_name: 'preferences-other-symbolic'
        });

        const groupQr = new Adw.PreferencesGroup({
            title: _('QR Codes')
        });

        const qrRow = new Adw.ActionRow({
            title: _('Auto-Open URLs'),
            subtitle: _('Automatically open HTTP/HTTPS links detected in QR codes.'),
            title_lines: 0, subtitle_lines: 0
        });

        const toggleQr = new Gtk.Switch({
            active: settings.get_boolean('qr-auto-open'),
            valign: Gtk.Align.CENTER,
        });

        settings.bind('qr-auto-open', toggleQr, 'active', Gio.SettingsBindFlags.DEFAULT);
        qrRow.add_suffix(toggleQr);
        qrRow.activatable_widget = toggleQr;
        groupQr.add(qrRow);
        
        pageAdvanced.add(groupQr);

        const groupTranslation = new Adw.PreferencesGroup({
            title: _('Translation (Experimental)')
        });

        const warningBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 12,
            visible: settings.get_boolean('translate-text'),
            margin_top: 4,
            margin_bottom: 12,
            css_classes: ['card'],
        });

        const warningIcon = new Gtk.Image({
            icon_name: 'dialog-warning-symbolic',
            pixel_size: 22,
            valign: Gtk.Align.START,
            margin_top: 14, margin_start: 14,
        });

        const warningTextBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 4,
            hexpand: true,
            margin_top: 12, margin_bottom: 12, margin_end: 14,
        });

        const warningTitle = new Gtk.Label({
            label: _('Privacy warning'),
            xalign: 0, hexpand: true,
            css_classes: ['heading'],
        });

        const warningLabel = new Gtk.Label({
            label: _('Auto-Translate sends extracted text to Google Translate. Privacy cannot be guaranteed when enabled.'),
            wrap: true, xalign: 0, hexpand: true,
            css_classes: ['dim-label'],
        });

        warningTextBox.append(warningTitle);
        warningTextBox.append(warningLabel);
        warningBox.append(warningIcon);
        warningBox.append(warningTextBox);

        settings.bind('translate-text', warningBox, 'visible', Gio.SettingsBindFlags.GET);

        groupTranslation.add(warningBox);

        const translateRow = new Adw.ActionRow({
            title: _('Auto-Translate Text'),
            subtitle: _('Automatically translate extracted text to your target language.'),
            title_lines: 0, subtitle_lines: 0
        });

        const toggleTranslate = new Gtk.Switch({
            active: settings.get_boolean('translate-text'),
            valign: Gtk.Align.CENTER,
        });

        settings.bind('translate-text', toggleTranslate, 'active', Gio.SettingsBindFlags.DEFAULT);
        translateRow.add_suffix(toggleTranslate);
        translateRow.activatable_widget = toggleTranslate;
        groupTranslation.add(translateRow);

        const langActionRow = new Adw.ActionRow({
            title: _('Target Language Code'),
            subtitle: _('e.g., en, fr, es, zh. Leave empty to use your system default language.'),
            title_lines: 0, subtitle_lines: 0
        });

        const langEntry = new Gtk.Entry({
            text: settings.get_string('translate-target'),
            valign: Gtk.Align.CENTER,
            width_chars: 6
        });

        settings.bind('translate-target', langEntry, 'text', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('translate-text', langActionRow, 'sensitive', Gio.SettingsBindFlags.GET);
        
        langActionRow.add_suffix(langEntry);
        groupTranslation.add(langActionRow);

        pageAdvanced.add(groupTranslation);

        const groupAdvancedSettings = new Adw.PreferencesGroup({
            title: _('Logging')
        });

        const debugRow = new Adw.ActionRow({
            title: _('Enable Debug Logging'),
            subtitle: _('Outputs detailed OCR and process logs to the system journal.'),
            title_lines: 0, subtitle_lines: 0
        });

        const toggleDebug = new Gtk.Switch({
            active: settings.get_boolean('enable-debug'),
            valign: Gtk.Align.CENTER,
        });

        settings.bind('enable-debug', toggleDebug, 'active', Gio.SettingsBindFlags.DEFAULT);
        debugRow.add_suffix(toggleDebug);
        debugRow.activatable_widget = toggleDebug;
        groupAdvancedSettings.add(debugRow);
        
        pageAdvanced.add(groupAdvancedSettings);

        const groupAbout = new Adw.PreferencesGroup({
            title: _('About')
        });
        
        groupAbout.add(new Adw.ActionRow({ title: _('Author'), subtitle: 'Christian Wittenberg', title_lines: 0, subtitle_lines: 0 }));
        
        groupAbout.add(new Adw.ActionRow({ 
            title: _('Version'), 
            subtitle: this.metadata.version !== undefined ? this.metadata.version.toString() : 'Local / EGO (Auto-injected)', 
            title_lines: 0, 
            subtitle_lines: 0 
        }));
        
        pageAdvanced.add(groupAbout);
        
        window.add(pageAdvanced);
    }
}