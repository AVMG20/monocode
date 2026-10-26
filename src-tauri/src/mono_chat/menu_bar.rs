//! Native menu presentation. Selectable rows remain ordinary NSMenuItems so
//! AppKit owns keyboard navigation, accessibility and actions. Each carries a
//! row view only so hover draws the translucent pill of the system's status
//! menus instead of the accent-colored selection.

use std::panic::AssertUnwindSafe;

use objc2::rc::Retained;
use objc2::runtime::NSObjectProtocol;
use objc2::runtime::{AnyObject, Bool};
use objc2::{define_class, msg_send, sel, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{
    NSAutoresizingMaskOptions, NSBezierPath, NSColor, NSFont, NSFontWeightRegular, NSImage,
    NSImageSymbolConfiguration, NSImageView, NSMenu, NSMenuItem, NSTextField, NSView,
};
use objc2_foundation::{NSPoint, NSRect, NSSize, NSString};

const WIDTH: f64 = 260.0;
const PORTRAIT_SIZE: f64 = 28.0;
const ROW_HEIGHT: f64 = 34.0;
/// Where AppKit placed the image and title of a plain item, so rows with a
/// view line up with the header the same way.
const IMAGE_X: f64 = 15.0;
const TITLE_X: f64 = 49.0;

pub(super) struct Action {
    pub id: &'static str,
    pub title: &'static str,
    symbol: &'static str,
    /// Tinted red, like other menus' destructive items.
    destructive: bool,
}

/// The menu's actions, each in its own group. Each gets a faint circle so
/// every title in the menu shares one column.
pub(super) const ACTIONS: [Action; 2] = [
    Action {
        id: "mono-chat-composer",
        title: "Quick Composer",
        symbol: "square.and.pencil",
        destructive: false,
    },
    Action {
        id: "mono-chat-quit",
        title: "Quit MonoCode",
        symbol: "power",
        destructive: true,
    },
];

pub(super) fn decorate(tray: &tauri::tray::TrayIcon) -> tauri::Result<()> {
    tray.with_inner_tray_icon(move |tray| {
        // Tauri dispatches this closure onto the main thread. Keep foreign
        // exceptions inside this boundary rather than unwinding through Rust.
        objc2::exception::catch(AssertUnwindSafe(|| {
            let mtm = MainThreadMarker::new().expect("native menu runs on the main thread");
            let Some(menu) = tray.ns_status_item().and_then(|status| status.menu(mtm)) else {
                return;
            };
            style_menu(&menu);
            for item in menu.itemArray() {
                if item.isSeparatorItem() || !item.isEnabled() {
                    continue;
                }
                let title = item.title().to_string();
                if let Some(action) = ACTIONS.iter().find(|a| a.title == title) {
                    let image = action_icon(action);
                    item.setImage(image.as_deref());
                    show_image(&item);
                    let color = if action.destructive {
                        NSColor::systemRedColor()
                    } else {
                        NSColor::labelColor()
                    };
                    item.setView(Some(&row(&title, image.as_deref(), &color, mtm)));
                }
            }
        }))
        .map_err(|exception| format!("Could not style the menu bar menu: {exception:?}"))
    })?
    .map_err(|error| std::io::Error::other(error).into())
}

/// macOS 27 hides menu item images unless the item asks to keep them.
fn show_image(item: &NSMenuItem) {
    // NSMenuItemImageVisibilityVisible; objc2-app-kit predates the property.
    const VISIBLE: isize = 1;
    if item.respondsToSelector(sel!(setPreferredImageVisibility:)) {
        let () = unsafe { msg_send![item, setPreferredImageVisibility: VISIBLE] };
    }
}

/// An SF Symbol in a faint circle the size of a Mono portrait. As a template
/// image it follows the menu's text color, including when highlighted; a
/// destructive action keeps its red instead.
fn action_icon(action: &Action) -> Option<Retained<NSImage>> {
    let red = NSColor::systemRedColor();
    let mut config = NSImageSymbolConfiguration::configurationWithPointSize_weight(13.0, unsafe {
        NSFontWeightRegular
    });
    if action.destructive {
        config = config.configurationByApplyingConfiguration(
            &NSImageSymbolConfiguration::configurationWithHierarchicalColor(&red),
        );
    }
    let glyph = NSImage::imageWithSystemSymbolName_accessibilityDescription(
        &NSString::from_str(action.symbol),
        None,
    )?
    .imageWithSymbolConfiguration(&config)?;
    let ink = if action.destructive {
        red.colorWithAlphaComponent(0.15)
    } else {
        NSColor::colorWithWhite_alpha(0.0, 0.12)
    };
    let draw = block2::RcBlock::new(move |rect: NSRect| {
        // Matches the portrait's circle: 1pt inside the image, faint ink.
        ink.setFill();
        NSBezierPath::bezierPathWithOvalInRect(NSRect::new(
            NSPoint::new(rect.origin.x + 1.0, rect.origin.y + 1.0),
            NSSize::new(rect.size.width - 2.0, rect.size.height - 2.0),
        ))
        .fill();
        let size = glyph.size();
        glyph.drawInRect(NSRect::new(
            NSPoint::new(
                rect.origin.x + (rect.size.width - size.width) / 2.0,
                rect.origin.y + (rect.size.height - size.height) / 2.0,
            ),
            size,
        ));
        Bool::YES
    });
    let image = NSImage::imageWithSize_flipped_drawingHandler(
        NSSize::new(PORTRAIT_SIZE, PORTRAIT_SIZE),
        false,
        &draw,
    );
    image.setTemplate(!action.destructive);
    Some(image)
}

define_class!(
    /// A selectable row. A menu item with a view draws nothing itself, so the
    /// row draws the hover pill and forwards clicks to the item's action.
    #[unsafe(super(NSView))]
    #[thread_kind = MainThreadOnly]
    #[name = "MonoCodeMenuRow"]
    struct MenuRow;

    impl MenuRow {
        #[unsafe(method(drawRect:))]
        fn draw_rect(&self, _dirty: NSRect) {
            if !self.enclosingMenuItem().is_some_and(|item| item.isHighlighted()) {
                return;
            }
            let bounds = self.bounds();
            NSColor::labelColor().colorWithAlphaComponent(0.1).setFill();
            NSBezierPath::bezierPathWithRoundedRect_xRadius_yRadius(
                NSRect::new(
                    NSPoint::new(bounds.origin.x + 5.0, bounds.origin.y),
                    NSSize::new(bounds.size.width - 10.0, bounds.size.height),
                ),
                10.0,
                10.0,
            )
            .fill();
        }

        #[unsafe(method(mouseUp:))]
        fn mouse_up(&self, _event: Option<&AnyObject>) {
            let Some(item) = self.enclosingMenuItem() else {
                return;
            };
            // The item is in the menu that is tracking this view.
            let Some(menu) = (unsafe { item.menu() }) else {
                return;
            };
            menu.cancelTracking();
            menu.performActionForItemAtIndex(menu.indexOfItem(&item));
        }
    }
);

fn row(
    title: &str,
    image: Option<&NSImage>,
    color: &NSColor,
    mtm: MainThreadMarker,
) -> Retained<NSView> {
    let frame = NSRect::new(NSPoint::ZERO, NSSize::new(WIDTH, ROW_HEIGHT));
    let view: Retained<MenuRow> = unsafe { msg_send![MenuRow::alloc(mtm), initWithFrame: frame] };
    view.setAutoresizingMask(NSAutoresizingMaskOptions::ViewWidthSizable);
    if let Some(image) = image {
        let icon = NSImageView::imageViewWithImage(image, mtm);
        icon.setFrame(NSRect::new(
            NSPoint::new(IMAGE_X, (ROW_HEIGHT - PORTRAIT_SIZE) / 2.0),
            NSSize::new(PORTRAIT_SIZE, PORTRAIT_SIZE),
        ));
        view.addSubview(&icon);
    }
    let label = NSTextField::labelWithString(&NSString::from_str(title), mtm);
    label.setFont(Some(&NSFont::systemFontOfSize(14.0)));
    label.setTextColor(Some(color));
    label.sizeToFit();
    let height = label.frame().size.height;
    label.setFrame(NSRect::new(
        NSPoint::new(TITLE_X, ((ROW_HEIGHT - height) / 2.0).round()),
        NSSize::new(WIDTH - TITLE_X - 16.0, height),
    ));
    label.setAutoresizingMask(NSAutoresizingMaskOptions::ViewWidthSizable);
    view.addSubview(&label);
    view.into_super()
}

fn style_menu(menu: &NSMenu) {
    menu.setMinimumWidth(WIDTH);
    unsafe { menu.setFont(Some(&NSFont::systemFontOfSize(14.0))) };
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_menu_action_draws_a_portrait_sized_symbol() {
        objc2::exception::catch(|| {
            for action in &ACTIONS {
                let title = action.title;
                let image = action_icon(action).unwrap_or_else(|| panic!("{title}"));
                assert_eq!(image.size(), NSSize::new(PORTRAIT_SIZE, PORTRAIT_SIZE));
                assert_eq!(image.isTemplate(), !action.destructive);
                let raster = unsafe {
                    image.CGImageForProposedRect_context_hints(std::ptr::null_mut(), None, None)
                };
                assert!(raster.is_some(), "{title} did not draw");
            }
        })
        .unwrap_or_else(|exception| panic!("AppKit rejected an action icon: {exception:?}"));
    }
}
