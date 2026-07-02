// build.rs — embed the Windows EXE icon. Drop `portal.ico` into rust/ (one level above this crate); the
// Windows build picks it up (taskbar + file icon). No-op on Linux/macOS and when the icon is absent.
//
// We invoke `windres` DIRECTLY and hand the compiled resource object straight to the linker via
// `rustc-link-arg`, rather than via a static lib — MinGW's linker garbage-collects an unreferenced
// resource lib (the icon silently vanishes), but a link-arg object is always included.
use std::env;
use std::path::Path;
use std::process::Command;

fn main() {
    println!("cargo:rerun-if-changed=../portal.ico");
    println!("cargo:rerun-if-changed=build.rs");

    if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return; // only the Windows exe carries a resource icon
    }
    let ico = Path::new("../portal.ico");
    if !ico.exists() {
        println!("cargo:warning=no ../portal.ico — building the Windows exe without an icon");
        return;
    }
    let ico_abs = match std::fs::canonicalize(ico) {
        Ok(p) => p.to_string_lossy().replace('\\', "/"),
        Err(e) => {
            println!("cargo:warning=icon: cannot resolve portal.ico: {e}");
            return;
        }
    };
    let out = env::var("OUT_DIR").unwrap();
    let rc = format!("{out}/portal.rc");
    let obj = format!("{out}/portal_res.o");
    // an .rc that names the icon as resource id 1 (the app icon Windows shows).
    if let Err(e) = std::fs::write(&rc, format!("1 ICON \"{ico_abs}\"\n")) {
        println!("cargo:warning=icon: cannot write .rc: {e}");
        return;
    }
    // the mingw windres for the gnu ABI (host is Linux); fall back to plain `windres` for MSVC hosts.
    let target = env::var("TARGET").unwrap_or_default();
    let windres = if target.contains("gnu") { "x86_64-w64-mingw32-windres" } else { "windres" };
    match Command::new(windres).arg(&rc).args(["-O", "coff", "-o", &obj]).status() {
        Ok(s) if s.success() => {
            // hand the resource object straight to the linker — it is always included this way.
            println!("cargo:rustc-link-arg={obj}");
            println!("cargo:warning=icon: portal.ico embedded (windres direct)");
        }
        Ok(s) => println!("cargo:warning=icon: windres exited {s}"),
        Err(e) => println!("cargo:warning=icon: could not run {windres}: {e}"),
    }
}
