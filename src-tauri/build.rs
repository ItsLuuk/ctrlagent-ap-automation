fn main() {
  // `frontendDist` is embedded into the app *library* at compile time, but the
  // frontend is not a declared input of that crate. A frontend-only change
  // (or a plain `tauri build` after one) therefore re-linked app.exe from the
  // cached rlib and embedded the previous bundle — the desktop app silently
  // kept shipping the old UI while the source said otherwise. Re-running the
  // build script on any frontend change invalidates that cached lib.
  //
  // `dist-tauri` is written before every build (`beforeBuildCommand`), and
  // every build replaces its hashed filenames, so both the directory and its
  // entry document change whenever the frontend does.
  println!("cargo:rerun-if-changed=../dist-tauri");
  println!("cargo:rerun-if-changed=../dist-tauri/index.html");
  println!("cargo:rerun-if-changed=../dist-tauri/assets");

  tauri_build::build()
}
