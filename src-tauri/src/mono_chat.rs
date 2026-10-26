//! The macOS menu bar icon. Its menu opens the quick composer or quits the
//! app; hiding it is remembered natively so it never flashes in at launch.

use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager};

mod menu_bar;

const TRAY: &str = "mono-menu-bar";

pub fn init(app: &AppHandle) -> tauri::Result<()> {
    let mut tray = TrayIconBuilder::with_id(TRAY)
        .tooltip("MonoCode")
        .menu(&menu(app)?)
        .icon_as_template(true)
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            if id == "mono-chat-composer" {
                crate::quick_composer::open(app);
            } else if id == "mono-chat-quit" {
                crate::window::request_quit(app);
            }
        });
    tray = tray.icon(menu_bar_icon().map_err(std::io::Error::other)?);
    let tray = tray.build(app)?;
    menu_bar::decorate(&tray)?;
    // Read natively so a hidden icon never flashes in before a window loads.
    if menu_bar_hidden_marker(app).is_some_and(|marker| marker.exists()) {
        tray.set_visible(false)?;
    }
    Ok(())
}

fn menu_bar_hidden_marker(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join("menu-bar-icon-hidden"))
}

/// Show or hide the menu bar icon, remembering the choice for next launch.
#[tauri::command]
pub fn mono_menu_bar_set_visible(app: AppHandle, visible: bool) -> Result<(), String> {
    let marker = menu_bar_hidden_marker(&app).ok_or("No app data directory.")?;
    if visible {
        match std::fs::remove_file(&marker) {
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
                return Err(error.to_string())
            }
            _ => {}
        }
    } else {
        if let Some(dir) = marker.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        std::fs::write(&marker, b"").map_err(|e| e.to_string())?;
    }
    if let Some(tray) = app.tray_by_id(TRAY) {
        tray.set_visible(visible).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn menu_bar_icon() -> Result<tauri::image::Image<'static>, png::DecodingError> {
    // Use the original monochrome mark, not the padded/shaded Dock tile.
    // tray-icon sizes images to 18pt on macOS. Remove the Dock padding, then
    // leave a 1pt margin so the mark itself is a slightly quieter 16pt.
    let mut reader = png::Decoder::new(std::io::Cursor::new(include_bytes!(
        "../macos/AppIcon.icon/Assets/icon.png"
    )))
    .read_info()?;
    let mut mask = vec![0; reader.output_buffer_size().unwrap()];
    let frame = reader.next_frame(&mut mask)?;
    let width = frame.width as usize;
    let height = frame.height as usize;
    let (mut left, mut top, mut right, mut bottom) = (width, height, 0, 0);
    for (index, pixel) in mask.as_chunks_mut::<4>().0.iter_mut().enumerate() {
        let light = u32::from(pixel[0].max(pixel[1]).max(pixel[2]));
        pixel[3] = (light * u32::from(pixel[3]) / 255) as u8;
        pixel[..3].fill(0);
        if pixel[3] > 0 {
            let (x, y) = (index % width, index / width);
            left = left.min(x);
            top = top.min(y);
            right = right.max(x + 1);
            bottom = bottom.max(y + 1);
        }
    }
    let padding = (bottom - top).div_ceil(16);
    let image_width = right - left + padding * 2;
    let image_height = bottom - top + padding * 2;
    let mut rgba = vec![0; image_width * image_height * 4];
    for y in top..bottom {
        let start = ((y - top + padding) * image_width + padding) * 4;
        rgba[start..start + (right - left) * 4]
            .copy_from_slice(&mask[(y * width + left) * 4..(y * width + right) * 4]);
    }
    Ok(tauri::image::Image::new_owned(
        rgba,
        image_width as u32,
        image_height as u32,
    ))
}

fn menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let mut builder = MenuBuilder::new(app);
    for (index, action) in menu_bar::ACTIONS.iter().enumerate() {
        if index > 0 {
            builder = builder.separator();
        }
        builder = builder.item(&MenuItemBuilder::with_id(action.id, action.title).build(app)?);
    }
    builder.build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn menu_bar_mark_is_sixteen_points_inside_the_standard_eighteen_point_image() {
        let icon = menu_bar_icon().unwrap();
        let width = icon.width() as usize;
        let height = icon.height() as usize;
        assert!(width > 0 && height > 0);
        let occupied_rows: Vec<_> = (0..height)
            .filter(|y| (0..width).any(|x| icon.rgba()[(y * width + x) * 4 + 3] > 0))
            .collect();
        let visible_height = occupied_rows.last().unwrap() - occupied_rows.first().unwrap() + 1;
        let points = 18.0 * visible_height as f64 / height as f64;
        assert!((points - 16.0).abs() < 0.05, "mark height: {points}pt");
        assert_eq!(
            *occupied_rows.first().unwrap(),
            height - occupied_rows.last().unwrap() - 1
        );
        // The terminal cutout and space around the orbit remain transparent.
        assert!(icon
            .rgba()
            .as_chunks::<4>()
            .0
            .iter()
            .any(|pixel| pixel[3] == 0));
    }
}
