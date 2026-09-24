fn main() {
  println!("cargo:rerun-if-env-changed=FOUNDRY_BUILD_ID");
  let build_id = std::env::var("FOUNDRY_BUILD_ID").unwrap_or_else(|_| "unversioned".to_string());
  println!("cargo:rustc-env=FOUNDRY_BUILD_ID={build_id}");
  tauri_build::build();
}
