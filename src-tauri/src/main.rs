#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if let Some(code) = monocode_lib::ssh_askpass::maybe_run() {
        std::process::exit(code);
    }
    #[cfg(all(debug_assertions, target_os = "macos"))]
    monocode_lib::ensure_macos_dev_bundle();
    monocode_lib::run()
}
