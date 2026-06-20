// smartmenu.js
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { OcrProcessor, isGibberish } from './ocr.js';
import { getMissingAppsErrorDialog } from './dependencies.js';
import { extractSmartEntities } from './smartextractor.js';

export class SmartMenu {
    constructor(ext) {
        this.ext = ext;
        this._smartMenu = null;
        this._smartMenuManager = null;
        this._smartMenuOpenTimeoutId = null;
        this._cursorTimeoutId = null;
        this._cancellable = new Gio.Cancellable();
    }

    async trigger(x, y) {
        this.destroyMenu();

        this.ext._logDebug(`Triggering Smart Extraction at pointer: X=${x}, Y=${y}`);

        let w = 800;
        let h = 200;
        
        let sx = x - (w / 2);
        let sy = y - (h / 2);

        let geometry = null;
        for (let m of Main.layoutManager.monitors) {
            if (x >= m.x && x < m.x + m.width && y >= m.y && y < m.y + m.height) {
                geometry = m;
                break;
            }
        }
        
        if (!geometry) {
            geometry = Main.layoutManager.primaryMonitor;
        }
        
        if (geometry) {
            if (sx < geometry.x) {
                sx = geometry.x;
            }
            if (sy < geometry.y) {
                sy = geometry.y;
            }
            if (sx + w > geometry.x + geometry.width) {
                sx = geometry.x + geometry.width - w;
            }
            if (sy + h > geometry.y + geometry.height) {
                sy = geometry.y + geometry.height - h;
            }
        } else {
            sx = Math.max(0, sx);
            sy = Math.max(0, sy);
        }

        if (this._cancellable) {
            this._cancellable.cancel();
        }
        let currentCancellable = new Gio.Cancellable();
        this._cancellable = currentCancellable;

        let errorDialog = getMissingAppsErrorDialog();
        if (errorDialog) {
            this.ext._showMissingDependencies(errorDialog);
            return;
        }

        let imagePath = null;
        let stream = null;
        let blankOverlay = null;
        let grab = null;

        let applyCursor = (cursorName) => {
            // Check for GNOME 46+ cursor method, otherwise fallback to GNOME 45
            if (blankOverlay?.set_cursor_type && Clutter.CursorType?.[cursorName] !== undefined) {
                blankOverlay.set_cursor_type(Clutter.CursorType[cursorName]);
            } else if (global.display?.set_cursor && Meta.Cursor?.[cursorName] !== undefined) {
                global.display.set_cursor(Meta.Cursor[cursorName]);
            }
        };

        try {
            let file;
            let tempStream;
            [file, tempStream] = Gio.File.new_tmp('snaptext-smart-XXXXXX.png');
            imagePath = file.get_path();
            tempStream.close(null);
            
            stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
        } catch (error) {
            if (!this._isCancelled(currentCancellable)) {
                this.ext._notifyError(`Could not create temporary screenshot file: ${error}`);
            }
            return;
        }

        try {
            blankOverlay = new St.Widget({
                reactive: true,
                can_focus: true,
                track_hover: true,
            });
            blankOverlay.add_constraint(new Clutter.BindConstraint({
                source: Main.layoutManager.uiGroup,
                coordinate: Clutter.BindCoordinate.ALL,
            }));
            Main.layoutManager.uiGroup.add_child(blankOverlay);

            applyCursor('BLANK');
            grab = Main.pushModal(blankOverlay);

            if (this._cursorTimeoutId) {
                GLib.source_remove(this._cursorTimeoutId);
                this._cursorTimeoutId = null;
            }

            // Allow compositor a tiny moment to render the blank cursor
            await new Promise(resolve => {
                this._cursorTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
                    this._cursorTimeoutId = null;
                    resolve();
                    return GLib.SOURCE_REMOVE;
                });
            });

            let gotScreenshot = await this.ext._takeScreenshot(sx, sy, w, h, stream);
            stream.close(null);

            applyCursor('DEFAULT');

            if (grab) {
                Main.popModal(grab);
                grab = null;
            } else if (blankOverlay) {
                Main.popModal(blankOverlay);
            }
            
            if (blankOverlay) {
                blankOverlay.destroy();
                blankOverlay = null;
            }

            if (gotScreenshot && !this._isCancelled(currentCancellable)) {
                const ocrProcessor = new OcrProcessor(currentCancellable, this.ext._activeProcesses, (msg) => this.ext._notifyError(msg), this.ext._logDebug.bind(this.ext));
                
                // Calculate local cursor position within the cropped screenshot
                let cursorLocalX = x - sx;
                let cursorLocalY = y - sy;

                // Fire the multi-pass logic
                let result = await ocrProcessor.processSmartImage(imagePath, cursorLocalX, cursorLocalY);
                
                if (!this._isCancelled(currentCancellable) && result !== null && result.text) {
                    this.show(x, y, result.text);
                }
            }
        } catch (error) {
            if (!this._isCancelled(currentCancellable)) {
                this.ext._logDebug(`Smart click extraction failed: ${error}`, true);
            }
        } finally {
            applyCursor('DEFAULT');

            if (grab) {
                Main.popModal(grab);
            } else if (blankOverlay) {
                Main.popModal(blankOverlay);
            }
            if (blankOverlay) {
                blankOverlay.destroy();
            }

            if (imagePath && GLib.file_test(imagePath, GLib.FileTest.EXISTS)) {
                if (GLib.unlink(imagePath) !== 0) {
                    this.ext._logDebug(`Could not remove temporary screenshot file`, true);
                }
            }
        }
    }

    show(x, y, text) {
        let cleanText = text.replace(/\s+/g, ' ').trim();
        if (!cleanText) return;

        let entities = extractSmartEntities(cleanText);
        let gibberish = isGibberish(cleanText);

        if (gibberish && entities.length === 0) {
            this.ext._logDebug('Smart OCR aborted: Result was gibberish and no entities found.');
            return;
        }

        this._smartMenuManager = new PopupMenu.PopupMenuManager(this.ext);
        
        Main.layoutManager.setDummyCursorGeometry(x, y, 2, 2);

        this._smartMenu = new PopupMenu.PopupMenu(Main.layoutManager.dummyCursor, 0.5, St.Side.TOP);
        this._smartMenuManager.addMenu(this._smartMenu);
        Main.layoutManager.uiGroup.add_child(this._smartMenu.actor);

        this._smartMenu.connectObject('menu-closed', () => {
            this.destroyMenu();
        }, this);

        if (!gibberish) {
            let abbrev = cleanText.length > 15 ? cleanText.substring(0, 15) + '...' : cleanText;
            let rawItem = new PopupMenu.PopupImageMenuItem(
                _('Copy text (%s)').replace('%s', abbrev),
                'edit-copy-symbolic'
            );
            rawItem.connectObject('activate', () => {
                this.ext._handleExtractedText(cleanText);
            }, this);
            this._smartMenu.addMenuItem(rawItem);
        } else if (entities.length > 0) {
            let headerItem = new PopupMenu.PopupMenuItem(_('Extracted Data:'), { reactive: false });
            headerItem.label.add_css_class('dim-label');
            this._smartMenu.addMenuItem(headerItem);
        }

        let foundEntities = false;
        
        for (let entity of entities) {
            if (!foundEntities && !gibberish) {
                this._smartMenu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            }
            foundEntities = true;

            let copyItem;

            // Action: Copy Entity
            if (entity.id === 'hex_color') {
                copyItem = new PopupMenu.PopupBaseMenuItem();
                
                let colorSwatch = new St.Widget({
                    style: `background-color: ${entity.value}; border-radius: 99px; border: 1px solid rgba(150, 150, 150, 0.4);`,
                    width: 16,
                    height: 16,
                    y_align: Clutter.ActorAlign.CENTER,
                    x_align: Clutter.ActorAlign.CENTER
                });
                
                // Wrap in a bin configured as an icon so GNOME automatically spaces it correctly next to the label
                let iconBin = new St.Bin({
                    child: colorSwatch,
                    style_class: 'popup-menu-icon',
                    y_align: Clutter.ActorAlign.CENTER,
                });

                let label = new St.Label({
                    text: `${entity.label}: ${entity.matchLabel}`,
                    y_align: Clutter.ActorAlign.CENTER
                });

                copyItem.add_child(iconBin);
                copyItem.add_child(label);
            } else {
                copyItem = new PopupMenu.PopupImageMenuItem(
                    `${entity.label}: ${entity.matchLabel}`,
                    entity.icon
                );
            }
            
            copyItem.connectObject('activate', () => {
                this.ext._handleExtractedText(entity.value);
            }, this);

            // Inline Action: Open Entity
            if (entity.uri) {
                let openIcon = new St.Icon({
                    icon_name: 'external-link-symbolic',
                    icon_size: 16,
                    style_class: 'popup-menu-icon'
                });
                
                let openBtn = new St.Button({
                    child: openIcon,
                    reactive: true,
                    can_focus: true,
                    track_hover: true // Required to trigger 'notify::hover'
                });
                
                const btnBaseStyle = 'border-radius: 99px; padding: 6px;';
                const btnHoverStyle = btnBaseStyle + ' background-color: rgba(150, 150, 150, 0.2);';
                
                openBtn.set_style(btnBaseStyle);
                
                // Manually handle hover visual feedback for absolute theme independence
                openBtn.connectObject('notify::hover', () => {
                    openBtn.set_style(openBtn.hover ? btnHoverStyle : btnBaseStyle);
                }, this);

                // Stop event bubbling so clicking the 'Open' button doesn't trigger the item's 'activate' (Copy)
                openBtn.connectObject('button-release-event', (actor, event) => {
                    try {
                        Gio.AppInfo.launch_default_for_uri(entity.uri, null);
                        if (this._smartMenu) this._smartMenu.close();
                    } catch (error) {
                        this.ext._logDebug(`Failed to open URI ${entity.uri}: ${error}`, true);
                    }
                    return Clutter.EVENT_STOP;
                }, this);

                openBtn.connectObject('button-press-event', () => Clutter.EVENT_STOP, this);
                openBtn.connectObject('touch-event', () => Clutter.EVENT_STOP, this);

                // Push the button to the far right of the menu item
                let expander = new St.Widget({ x_expand: true });
                copyItem.add_child(expander);
                copyItem.add_child(openBtn);
            }

            this._smartMenu.addMenuItem(copyItem);
        }

        if (this._smartMenuOpenTimeoutId) {
            GLib.source_remove(this._smartMenuOpenTimeoutId);
            this._smartMenuOpenTimeoutId = null;
        }
        this._smartMenuOpenTimeoutId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._smartMenuOpenTimeoutId = null;
            if (this._smartMenu) {
                this._smartMenu.open(BoxPointer.PopupAnimation.FADE);
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    destroyMenu() {
        if (this._smartMenu) {
            this._smartMenu.disconnectObject(this);
            this._smartMenu.destroy();
            this._smartMenu = null;
        }
        if (this._smartMenuManager) {
            this._smartMenuManager = null;
        }
    }

    destroy() {
        this.destroyMenu();
        if (this._smartMenuOpenTimeoutId) {
            GLib.source_remove(this._smartMenuOpenTimeoutId);
            this._smartMenuOpenTimeoutId = null;
        }
        if (this._cursorTimeoutId) {
            GLib.source_remove(this._cursorTimeoutId);
            this._cursorTimeoutId = null;
        }
        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }
        this.ext = null;
    }

    _isCancelled(cancellable = this._cancellable) {
        return !cancellable || cancellable.is_cancelled();
    }
}